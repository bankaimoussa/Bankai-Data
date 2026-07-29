require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const multer = require("multer");
const ocr = require("./ocr");

const app = express();
app.use(cors());
app.use(express.json());

// رفع الصور في الذاكرة (بدون كتابة على القرص) - حد أقصى 8MB للصورة
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("الصورة لازم تكون JPEG أو PNG أو WEBP"));
    }
    cb(null, true);
  }
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

if (!ADMIN_PASSWORD || !JWT_SECRET || !SPREADSHEET_ID) {
  console.error("Missing required environment variables. Check .env / hosting config.");
}

// ---------- Google Sheets auth ----------
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Column order must match the sheet exactly (A -> Q)
const COLUMNS = [
  "siteCode", "vendor", "daName", "nationalId", "email",
  "transporterId", "vehicleType", "vehiclePlate", "modelType",
  "phone", "licenseIssuance", "licenseExpiration", "dob",
  "licenseNumber", "licenseType", "flex", "address"
];
const SHEET_RANGE_COLS = "Q";

// BRANCHES format: "DisplayName:ActualSheetTabName,DisplayName2:ActualSheetTabName2"
// لو مفيش ":" هيتعامل مع الاسم كـ اسم عرض واسم تاب في نفس الوقت
// مثال: "QCD1:QCD1DATA,QCD2:QCD2 DATA"
const BRANCH_MAP = {}; // displayName -> actual sheet tab name
(process.env.BRANCHES || "QCD1,QCD2").split(",").forEach(entry => {
  const trimmed = entry.trim();
  if (trimmed.includes(":")) {
    const [display, actual] = trimmed.split(":");
    BRANCH_MAP[display.trim()] = actual.trim();
  } else {
    BRANCH_MAP[trimmed] = trimmed;
  }
});
const BRANCHES = Object.keys(BRANCH_MAP);

// ---------- Auth middleware ----------
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "غير مصرح لك بالدخول" });
  }
  const token = header.slice(7);
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "الجلسة منتهية، سجّل دخول تاني" });
  }
}

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة" });
});

app.get("/api/branches", requireAuth, (req, res) => {
  res.json({ success: true, branches: BRANCHES });
});

// Get all DAs for a branch
app.get("/api/branch/:branch", requireAuth, async (req, res) => {
  try {
    const branch = req.params.branch;
    const sheetTab = BRANCH_MAP[branch];
    if (!sheetTab) {
      return res.status(400).json({ success: false, message: "فرع غير معروف" });
    }
    const sheets = await getSheetsClient();
    const range = `'${sheetTab}'!A2:${SHEET_RANGE_COLS}1000`;
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });
    const rows = result.data.values || [];
    const das = rows
      .map((row, idx) => {
        const obj = { rowIndex: idx + 2 };
        COLUMNS.forEach((key, i) => {
          obj[key] = row[i] || "";
        });
        return obj;
      })
      .filter(d => d.daName && d.daName.trim() !== "");
    res.json({ success: true, data: das });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في قراءة الشيت: " + err.message });
  }
});

// Add new DA
app.post("/api/branch/:branch", requireAuth, async (req, res) => {
  try {
    const branch = req.params.branch;
    const sheetTab = BRANCH_MAP[branch];
    if (!sheetTab) {
      return res.status(400).json({ success: false, message: "فرع غير معروف" });
    }
    const data = req.body;
    if (!data.daName || !data.nationalId) {
      return res.status(400).json({ success: false, message: "اسم المندوب والرقم القومي مطلوبين" });
    }
    const row = COLUMNS.map(key => data[key] || "");
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetTab}'!A2:${SHEET_RANGE_COLS}2`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] }
    });
    res.json({ success: true, message: "تمت الإضافة" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الإضافة: " + err.message });
  }
});

// Update existing DA (by row index)
app.put("/api/branch/:branch/:rowIndex", requireAuth, async (req, res) => {
  try {
    const branch = req.params.branch;
    const sheetTab = BRANCH_MAP[branch];
    const rowIndex = parseInt(req.params.rowIndex, 10);
    if (!sheetTab || !rowIndex || rowIndex < 2) {
      return res.status(400).json({ success: false, message: "طلب غير صالح" });
    }
    const data = req.body;
    const row = COLUMNS.map(key => data[key] || "");
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetTab}'!A${rowIndex}:${SHEET_RANGE_COLS}${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] }
    });
    res.json({ success: true, message: "تم التعديل" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التعديل: " + err.message });
  }
});

// Delete DA (clears the row)
app.delete("/api/branch/:branch/:rowIndex", requireAuth, async (req, res) => {
  try {
    const branch = req.params.branch;
    const sheetTab = BRANCH_MAP[branch];
    const rowIndex = parseInt(req.params.rowIndex, 10);
    if (!sheetTab || !rowIndex || rowIndex < 2) {
      return res.status(400).json({ success: false, message: "طلب غير صالح" });
    }
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetTab}'!A${rowIndex}:${SHEET_RANGE_COLS}${rowIndex}`
    });
    res.json({ success: true, message: "تم الحذف" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف: " + err.message });
  }
});

// ---------- OCR (استخراج بيانات من صور المستندات فقط، بدون تخزين الصورة) ----------
// docType المتاحة: nationalId | licenseDriving | licenseVehicle
app.post("/api/ocr/:docType", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const docType = req.params.docType;
    if (!ocr.DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: "نوع مستند غير معروف" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "لم يتم إرفاق صورة" });
    }

    const base64Image = req.file.buffer.toString("base64");

    let extracted;
    try {
      extracted = await ocr.extractFromImage(docType, base64Image);
    } catch (ocrErr) {
      console.error("OCR error:", ocrErr);
      return res.status(502).json({ success: false, message: "فشل استخراج البيانات: " + ocrErr.message });
    }

    res.json({
      success: true,
      data: extracted
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ غير متوقع: " + err.message });
  }
});

// Multer errors (حجم الصورة كبير / نوع غير مدعوم) بترجع كـ exception عادي - نمسكها هنا
app.use((err, req, res, next) => {
  if (err && err.message) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`DA backend running on port ${PORT}`);
});

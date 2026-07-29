// ============================================================
// ocr.js — استخراج بيانات المندوب من صور (بطاقة / رخصة) عبر Ollama Cloud
// ============================================================

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";
const OLLAMA_URL = "https://ollama.com/api/chat";

// docType: nationalId | licenseDriving | licenseVehicle
const PROMPTS = {
  nationalId: `
انت نظام استخراج بيانات من صورة بطاقة رقم قومي مصرية.
اقرأ الصورة المرفقة واستخرج البيانات دي بس. لو أي حقل مش واضح أو مش موجود، سيبه فاضي "".
رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "daName": "الاسم الرباعي كامل زي ما هو مكتوب",
  "nationalId": "الرقم القومي (14 رقم)",
  "dob": "تاريخ الميلاد بصيغة YYYY-MM-DD لو أمكن استنتاجه، وإلا زي ما هو مكتوب",
  "address": "العنوان كامل زي ما هو مكتوب"
}
`.trim(),

  licenseDriving: `
انت نظام استخراج بيانات من صورة رخصة قيادة مصرية (رخصة تسيير مركبة للسائق).
اقرأ الصورة المرفقة واستخرج البيانات دي بس. لو أي حقل مش واضح أو مش موجود، سيبه فاضي "".
رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "licenseNumber": "رقم الرخصة",
  "licenseType": "نوع الرخصة (خصوصي / دراجة نارية / نقل ثقيل ... الخ)",
  "licenseIssuance": "تاريخ الإصدار بصيغة YYYY-MM-DD",
  "licenseExpiration": "تاريخ الانتهاء بصيغة YYYY-MM-DD",
  "daName": "اسم صاحب الرخصة زي ما هو مكتوب"
}
`.trim(),

  licenseVehicle: `
انت نظام استخراج بيانات من صورة رخصة مركبة مصرية (رخصة الدراجة النارية أو السيارة نفسها).
اقرأ الصورة المرفقة واستخرج البيانات دي بس. لو أي حقل مش واضح أو مش موجود، سيبه فاضي "".
رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "vehiclePlate": "رقم لوحة المركبة زي ما هي مكتوبة",
  "vehicleType": "نوع المركبة (Motorbike / Car / ... الخ)",
  "modelType": "موديل/طراز المركبة وسنة الصنع لو موجودة",
  "licenseExpiration": "تاريخ انتهاء ترخيص المركبة بصيغة YYYY-MM-DD"
}
`.trim()
};

function stripCodeFence(text) {
  let t = text.trim();
  t = t.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  return t.trim();
}

// Gemma 4 (thinking mode) قد يرجّع القناة الداخلية جوه tags زي <|channel>thought...
// بنشيلها ونمسك آخر { ... } كـ JSON فعلي.
function extractJson(raw) {
  let text = stripCodeFence(raw);
  // شيل أي thinking channel لو ظهر
  text = text.replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, "").trim();
  text = text.replace(/<\|think\|>/gi, "").trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("لم يتم العثور على JSON في رد النموذج");
  }
  const jsonSlice = text.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonSlice);
}

// base64Image: بيانات الصورة base64 بدون data:...;base64, prefix
async function extractFromImage(docType, base64Image) {
  if (!OLLAMA_API_KEY) {
    throw new Error("OLLAMA_API_KEY غير مضبوط في متغيرات البيئة");
  }
  const prompt = PROMPTS[docType];
  if (!prompt) {
    throw new Error("نوع مستند غير معروف: " + docType);
  }

  const body = {
    model: OLLAMA_MODEL,
    messages: [
      {
        // بدون تفعيل <|think|> في الـ system عشان نتفادى overhead الـ thinking في مهمة استخراج بسيطة
        role: "system",
        content: "أنت أداة استخراج بيانات دقيقة. رجّع JSON صحيح فقط بدون أي نص إضافي."
      },
      {
        role: "user",
        content: prompt,
        images: [base64Image]
      }
    ],
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      // بادجت توكن الصورة عالي للـ OCR ودقة قراءة النصوص الصغيرة (راجع توصيات gemma4 لمهام OCR)
      num_predict: 700
    }
  };

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + OLLAMA_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Ollama request failed", {
      status: res.status,
      model: OLLAMA_MODEL,
      body: errText
    });
    throw new Error(`فشل الاتصال بـ Ollama (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data && data.message && data.message.content;
  if (!content) {
    throw new Error("رد فارغ من النموذج");
  }

  return extractJson(content);
}

module.exports = { extractFromImage, DOC_TYPES: Object.keys(PROMPTS) };

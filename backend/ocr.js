// ============================================================
// ocr.js — استخراج بيانات المندوب من صور (بطاقة / رخصة) عبر Ollama Cloud
// ============================================================

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";
const OLLAMA_URL = "https://ollama.com/api/chat";

// قواعد عامة مشتركة بتتضاف لكل الـ prompts عشان ترفع دقة القراءة
const COMMON_RULES = `
قواعد صارمة لازم تلتزم بيها:
- اقرأ كل حرف ورقم بعناية شديدة، خصوصًا الأرقام المتشابهة شكلها (0/O، 1/7، 5/6، 8/3، 9/4).
- لو في أكتر من نسخة/طبعة للحقل نفسه في الصورة (مثلاً الاسم مكتوب مرتين)، استخدم النسخة الأوضح والأكمل.
- متخترعش أو متكملش أي بيانات ناقصة أو غير واضحة من عندك؛ لو الحقل مش موجود فعليًا في الصورة أو مش قادر تقرأه بثقة، سيبه فاضي "".
- الأرقام (الرقم القومي، أرقام الرخص، اللوحات) لازم تتقرأ رقم رقم بدقة، وتتأكد من عدد الخانات الصحيح قبل ما ترجعها.
- التواريخ ترجع بصيغة YYYY-MM-DD حصريًا لو قدرت تحدد اليوم والشهر والسنة بوضوح، غير كده اكتبها زي ما هي مكتوبة بالظبط.
- لا تضف أي حروف أو مسافات زيادة، ولا تترجم أو تعرّب أي نص غير الاسم (اللي له تعليمات خاصة توضح إزاي يتكتب بالإنجليزي)، وباقي الحقول انسخها زي ما هي مكتوبة بالظبط في مكانها الصحيح.
`.trim();

// docType: nationalId | licenseDriving | licenseVehicle
const PROMPTS = {
  nationalId: `
انت نظام استخراج بيانات دقيق جدًا من صورة بطاقة رقم قومي مصرية (البطاقة الشخصية الحكومية، الوجه الأمامي أو الخلفي).

${COMMON_RULES}

تعليمات خاصة بكل حقل:
- daName: الاسم الثلاثي/الرباعي لصاحب البطاقة بحروف إنجليزية (Latin letters) فقط. لو البطاقة فيها نسخة إنجليزية مطبوعة للاسم، انسخها زي ما هي بالظبط. لو مفيش نسخة إنجليزية مطبوعة في الصورة، حوّل الاسم العربي المكتوب إلى Transliteration إنجليزي قياسي (مثال: "محمد أحمد علي" → "Mohamed Ahmed Ali")، بحروف إنجليزية فقط بدون أي حرف عربي، وابدأ كل كلمة بحرف كبير.
- nationalId: الرقم القومي المكون من 14 رقم بالظبط، تحته عادة يبقى مكتوب بخط كبير وواضح.
- dob: تاريخ الميلاد. ممكن تستنتجه من الرقم القومي نفسه لو الرقم واضح (الرقم القومي المصري: الرقم الأول = القرن (2=1900s, 3=2000s)، بعده سنتين السنة، بعدهم شهرين الشهر، بعدهم يومين اليوم)، أو من الحقل المطبوع لو موجود.
- address: العنوان بالكامل زي ما هو مكتوب على البطاقة.

رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "daName": "",
  "nationalId": "",
  "dob": "",
  "address": ""
}
`.trim(),

  licenseDriving: `
انت نظام استخراج بيانات دقيق جدًا من صورة رخصة قيادة مصرية (رخصة تسيير مركبة للسائق، بتاعة إدارة المرور).

${COMMON_RULES}

تعليمات خاصة بكل حقل:
- daName: اسم صاحب الرخصة بحروف إنجليزية (Latin letters) فقط. رخص القيادة المصرية غالبًا بتحتوي على اسم صاحب الرخصة مطبوع بالإنجليزي في مكان قريب من الاسم العربي أو أسفله — لو موجود، انسخه حرف حرف زي ما هو مكتوب بالظبط (بدون ترجمة من عندك). لو مفيش نسخة إنجليزية مطبوعة في الصورة خالص، حوّل الاسم العربي إلى Transliteration إنجليزي قياسي بحروف إنجليزية فقط، وابدأ كل كلمة بحرف كبير. النتيجة النهائية لازم تكون بالإنجليزي فقط بدون أي حرف عربي.
- nationalId: لو الرقم القومي (14 رقم) مطبوع في الرخصة، اكتبه هنا. لو مش موجود في الرخصة، سيبه فاضي "".
- licenseNumber: رقم الرخصة نفسها.
- licenseType: نوع/درجة الرخصة زي ما هي مكتوبة (خصوصي / دراجة نارية / نقل ثقيل / أجرة ... إلخ).
- licenseIssuance: تاريخ إصدار الرخصة.
- licenseExpiration: تاريخ انتهاء الرخصة.

رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "licenseNumber": "",
  "licenseType": "",
  "licenseIssuance": "",
  "licenseExpiration": "",
  "daName": "",
  "nationalId": ""
}
`.trim(),

  licenseVehicle: `
انت نظام استخراج بيانات دقيق جدًا من صورة رخصة مركبة مصرية (رخصة الدراجة النارية أو السيارة نفسها، مش رخصة القيادة).

${COMMON_RULES}

تعليمات خاصة بكل حقل:
- vehiclePlate: رقم لوحة المركبة زي ما هو مكتوب بالظبط (أرقام وحروف عربي عادة)، حافظ على ترتيب الحروف والأرقام زي الأصل.
- vehicleType: نوع المركبة (Motorbike / Car / ... إلخ) حسب اللي واضح في الرخصة.
- modelType: موديل/طراز المركبة وسنة الصنع لو موجودة في الرخصة.
- licenseExpiration: تاريخ انتهاء ترخيص المركبة (مش رخصة القيادة، دي رخصة المركبة نفسها).

رجّع النتيجة بصيغة JSON فقط، من غير أي شرح أو نص إضافي أو Markdown، بالشكل ده بالظبط:

{
  "vehiclePlate": "",
  "vehicleType": "",
  "modelType": "",
  "licenseExpiration": ""
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
        content: "أنت أداة استخراج بيانات دقيقة ومتخصصة في قراءة المستندات الرسمية المصرية. دقة القراءة أهم من السرعة. رجّع JSON صحيح فقط بدون أي نص إضافي."
      },
      {
        // الصورة قبل النص لأفضل أداء متعدد الوسائط (راجع توصيات gemma4)
        role: "user",
        content: prompt,
        images: [base64Image]
      }
    ],
    stream: false,
    options: {
      temperature: 0.15,
      top_p: 0.9,
      top_k: 40,
      // بادجت توكن الصورة أعلى قيمة متاحة (1120) لدقة أفضل في قراءة النصوص والأرقام الصغيرة على المستندات
      image_token_budget: 1120,
      num_predict: 900
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

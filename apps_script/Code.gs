// 部署步骤见项目根目录 README.md 的"配置 Google Sheets 同步"部分
// 把下面这个占位符换成你自己随便打的一串字符，并且要跟 backend/.env 里的
// SHEETS_TOKEN 填一样的值——这是用来防止陌生人乱写你的表格的密钥，每个人部署
// 自己的副本时都应该换成自己的值，不要沿用别人的。
var TOKEN = "换成你自己的随机字符串";

function doPost(e) {
  var result = { ok: false };
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) {
      result.error = "unauthorized";
      return respond(result);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === "word") {
      var wordSheet = ss.getSheetByName("生词");
      if (!wordSheet) {
        wordSheet = ss.getSheets()[0];
        wordSheet.setName("生词");
        if (wordSheet.getLastRow() === 0) {
          wordSheet.appendRow(["单词", "例句", "中文释义", "音标", "词性", "文章来源", "日期"]);
        }
      }
      wordSheet.appendRow([
        data.word || "",
        data.sentence || "",
        data.chinese_meaning || "",
        data.ipa || "",
        data.pos || "",
        data.source || "",
        data.date || "",
      ]);
    } else if (data.type === "sentence") {
      var noteSheet = ss.getSheetByName("句子笔记");
      if (!noteSheet) {
        noteSheet = ss.insertSheet("句子笔记");
        noteSheet.appendRow(["原句", "AI解析", "文章来源", "日期"]);
      }
      noteSheet.appendRow([data.sentence || "", data.analysis || "", data.source || "", data.date || ""]);
    } else {
      result.error = "unknown type";
      return respond(result);
    }

    result.ok = true;
    return respond(result);
  } catch (err) {
    result.error = String(err);
    return respond(result);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("English Learner Sheet Webhook is running.");
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 部署步骤见项目根目录 README.md 的"配置 Google Sheets 同步"部分
// 这个 token 要和 backend/.env 里的 SHEETS_TOKEN 保持一致，已经帮你对好了，不用改
var TOKEN = "f39fbb5b4e0046c38435b25c6a2759ab";

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

// ============================================
// Googleスプレッドシート単体で動く学習管理テンプレート(Apps Script、コンテナバインド)。
// Webアプリ(doGet/doPost)は使わず、スプレッドシートを開いてメニュー「LMS Menu」を
// 操作するだけで動く。機能: ①生徒マスター ②週間計画 ③参考書の正答記録
// ④講師アドバイス(メール通知)。生徒はスプレッドシートを開かず、Googleフォームから
// 正答記録を入力し、講師アドバイスはメールで受け取る。
// 管理者メールアドレス等の値はダミーで、各シートにサンプルデータを入れてあるので、
// 開けば操作イメージが分かる(実運用前にシステム初期化、またはサンプル行の削除をすること)。
//
// ■ 生徒の登録は1段階
// 生徒が外部から自由に申請してくる運用ではなく、管理者(塾長)が生徒を直接把握している
// 少人数運用を想定し、「👥 生徒プロフィールに生徒名・メールアドレスを直接入力→その場で
// ID発行」という1段階のフローにしている(issueStudentId関数)。外部からの申請受付が
// 必要な場合は、申請受付シートと承認処理を別途追加する。
// ============================================

// ============================================
// 0. 生徒プロフィールの受験科目列定義
// ============================================
// 数学・英語は中学範囲まで遅れている生徒がいる前提で学校範囲別に分割する
// (少人数の個別指導のため、高校生でも中学内容からの立て直しが普通にあり得る)。
// それ以外の科目は高校で新規に学ぶ前提が強いため1科目1列のままにしている。
// 列の増減はこの配列を編集するだけでよい(initializeSystemで参照している)。
var STUDENT_PROFILE_SUBJECT_COLUMNS = [
  "数学(中学範囲)", "数学(高校IA)", "数学(高校IIB)", "数学(高校III)",
  "英語(中学範囲)", "英語(高校)",
  "国語",
  "物理", "化学", "生物", "地学",
  "日本史", "世界史", "地理", "公民(倫理・政治経済)"
];

// シート名は定数化しておく(複数の関数から参照するため、タイプミスによる不整合を防ぐ)
var SHEET_README = "📘 README";
var SHEET_CONFIG = "⚙️ システム設定";
var SHEET_ACCOUNT = "⚙️ アカウント設定";
var SHEET_PROFILE = "👥 生徒プロフィール";
var SHEET_WEEKLY_PLAN = "📅 週間計画";
var SHEET_TEXTBOOK_MASTER = "📖 参考書マスター";
var SHEET_ANSWER_RECORD = "✅ 正答記録";
var SHEET_ANSWER_SUMMARY = "📈 正答率サマリー";
var SHEET_ADVICE = "📣 講師アドバイス";
var SHEET_PROBLEM_STATUS = "📊 問題別正答状況";
var SHEET_FORM_RESPONSES = "📨 正答記録フォーム回答"; // setupAnswerRecordForm実行時に動的に作られる
var FORM_ID_PROPERTY_KEY = "ANSWER_RECORD_FORM_ID";
var SPREADSHEET_ID_PROPERTY_KEY = "LMS_SPREADSHEET_ID";
// 生徒へのメール件名の頭に付ける。塾名が決まったら差し替える(例: "【○○塾】")
var MAIL_SUBJECT_PREFIX = "【学習管理】";

// 正答記録フォームの回答用URL。フォームが未作成、または開けない場合は""を返す。
function getAnswerRecordFormUrl() {
  var formId = PropertiesService.getScriptProperties().getProperty(FORM_ID_PROPERTY_KEY);
  if (!formId) return "";
  try {
    return FormApp.openById(formId).getPublishedUrl();
  } catch (err) {
    return "";
  }
}

// 問題の記法。Googleフォームの入力チェックと、送信後の正規化の両方で同じ規則を使う。
// スマホで打たれやすい全角数字や、長音記号「ー」などハイフンの代用も受け付け、記録時に半角へ揃える。
var PAGE_PATTERN = "^\\s*[pPｐＰ]?\\.?\\s*[0-9０-９]+\\s*$";
var PROBLEM_NUMBER_PATTERN = "^\\s*[0-9０-９]+(\\s*[-－ー‐−]\\s*[0-9０-９]+){0,2}\\s*$";
var NO_TYPE_LABEL = "(種別なし)";

// ============================================
// 1. Spreadsheet Menu Setup (onOpen)
// ============================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('LMS Menu')
      .addItem('選択した生徒にIDを発行する (ID発行＆メール送信)', 'issueStudentId')
      .addSeparator()
      .addItem('今週の計画を記録する', 'showWeeklyPlanDialog')
      .addItem('正答記録を入力する', 'showAnswerRecordDialog')
      .addItem('講師アドバイスを記録する', 'showTutorAdviceDialog')
      .addSeparator()
      .addItem('生徒向け正答記録フォームを作成/更新', 'setupAnswerRecordForm')
      .addItem('正答率サマリー・問題別状況を再構築', 'runUpdateAnswerRateSummary')
      .addSeparator()
      .addItem('システム初期化 (※全データ消去)', 'initializeSystem')
      .addToUi();
}

// ============================================
// 2. System Setup (All Clean and Rebuild)
// ============================================
function initializeSystem() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var resp = ui.alert("⚠️ 警告 ⚠️", "スプレッドシートの完全初期化を実行します。既存のすべてのデータは完全に消去されます。本当によろしいですか？", ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  var doubleCheck = ui.alert("⚠️ 最終確認 ⚠️", "本当にデータを削除しますね？この操作は取り消せません。", ui.ButtonSet.YES_NO);
  if (doubleCheck !== ui.Button.YES) return;

  // 1枚ダミーシートを作って残りのシートを全削除
  var dummy = ss.insertSheet("SYSTEM_SETUP_TEMP");
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== "SYSTEM_SETUP_TEMP") {
      try {
        ss.deleteSheet(sheets[i]);
      } catch (e) {
        Logger.log("Delete failed: " + e.toString());
      }
    }
  }

  // 0. README Sheet — 一番左のタブになるよう、他より先に(index 1 = ダミーの直後)作る。
  // 最後にダミーシートを消すと、これが一番左(1番目)のシートになる。
  var readmeSheet = ss.insertSheet(SHEET_README, 1);
  var readmeLines = [
    ["このスプレッドシートについて", ""],
    ["", ""],
    ["これは個別指導塾向け学習管理システムのプロトタイプです。", ""],
    ["各シートにサンプルデータが入っています。実際に使う前に、サンプル行は削除するか", ""],
    ["「LMS Menu > システム初期化」でまっさらな状態に戻してください。", ""],
    ["", ""],
    ["■ シートの役割", ""],
    [SHEET_CONFIG, "管理者メールアドレスなど、システム全体の設定値"],
    [SHEET_ACCOUNT, "生徒のログインID・パスワード等、認証情報専用(他の用途で編集しない)"],
    [SHEET_PROFILE, "生徒ごとの志望校・受験科目(チェックボックス)。新規生徒はこのシートに直接登録する"],
    [SHEET_WEEKLY_PLAN, "生徒ごとの週間計画を履歴として記録(メニューの「今週の計画を記録する」)"],
    [SHEET_TEXTBOOK_MASTER, "使う参考書と、参考書ごとの記法の決まり(種別・ページを使うか・最大ページ)。塾長が登録する"],
    [SHEET_ANSWER_RECORD, "生徒が参考書の問題を解いた結果(〇/△/×)の記録(メニューの「正答記録を入力する」)"],
    [SHEET_ANSWER_SUMMARY, "正答記録の集計(生徒×参考書の正答率)。メニューの「再構築」で最新化する"],
    [SHEET_PROBLEM_STATUS, "生徒ごと・問題ごとの最新結果の一覧(面談用)。メニューの「再構築」で最新化する"],
    [SHEET_ADVICE, "講師から生徒へのアドバイス記録。記録と同時に生徒へメールで通知される(メニューの「講師アドバイスを記録する」)"],
    ["", ""],
    ["■ 新規生徒の登録方法", ""],
    [SHEET_PROFILE + "に生徒名・生徒メールアドレスだけを直接入力して1行追加し、", ""],
    ["その行を選んで「LMS Menu > 選択した生徒にIDを発行する」を実行してください。", ""],
    ["", ""],
    ["■ 生徒による正答記録の入力", ""],
    ["「正答記録を入力する」(LMS Menu)はスプレッドシートを開ける塾長・講師専用です。生徒自身が", ""],
    ["入力する場合は、「LMS Menu > 生徒向け正答記録フォームを作成/更新」で発行されるGoogle", ""],
    ["フォームのURLを生徒に配布してください(生徒や参考書を追加したら選択肢の更新のため再実行)。", ""],
    ["なりすまし防止のため、フォームでは生徒名ではなく生徒ID(ID発行時のメールに記載)を入力させています。", ""],
    ["", ""],
    ["■ 問題の記法", ""],
    ["問題は「参考書名・種別・ページ・問題番号」で表します。問題番号は「大問-小問-小小問」の形式で、", ""],
    ["小問・小小問は省略できます(例: 12、3-2、3-2-1)。種別とページは参考書ごとに使うかどうかが違うため、", ""],
    [SHEET_TEXTBOOK_MASTER + "で参考書ごとに決めます(種別はカンマ区切りで列挙、空欄なら種別なし)。", ""],
    ["決まりに合わない記録は弾くか(講師の入力)、備考に「要確認」と残します(生徒のフォーム入力)。", ""],
    ["", ""],
    ["■ このプロトタイプに含まれていないもの", ""],
    ["生徒がWebブラウザ等から直接アクセスする画面(doGet/doPostのWebアプリ部分)は含みません。", ""],
    ["現状はスプレッドシートを開ける人(塾長・講師)が直接操作する前提です(正答記録の入力は", ""],
    ["上記のGoogleフォーム経由、講師アドバイスの確認はメール通知で、生徒自身が行えます)。", ""],
    ["質問箱・学習時間ログ・実力診断結果の集計は含みません。", ""]
  ];
  readmeSheet.getRange(1, 1, readmeLines.length, 2).setValues(readmeLines);
  readmeSheet.getRange("A1:B1").setFontWeight("bold").setFontSize(14);
  // 見出し行(■始まり)は行番号を決め打ちせず探す(説明文を足すたびに番号がずれるため)
  for (var r = 0; r < readmeLines.length; r++) {
    if (readmeLines[r][0].indexOf("■") === 0) {
      readmeSheet.getRange(r + 1, 1, 1, 2).setFontWeight("bold").setBackground("#e2e8f0");
    }
  }
  readmeSheet.setColumnWidth(1, 220);
  readmeSheet.setColumnWidth(2, 500);

  // 1. Config Sheet (⚙️ システム設定)
  var configSheet = ss.insertSheet(SHEET_CONFIG);
  configSheet.appendRow(["設定項目", "設定値", "説明"]);
  configSheet.appendRow(["管理者メールアドレス", "admin@gmail.com", "テスト結果や質問の通知先(ダミー。実際の塾長のメールに差し替える)"]);
  configSheet.getRange("A1:C1").setFontWeight("bold").setBackground("#f1f5f9");
  configSheet.getRange("A1:C2").setBorder(true, true, true, true, true, true);

  // 2. Account Sheet (⚙️ アカウント設定) — サンプル生徒を1件入れておく
  var accountSheet = ss.insertSheet(SHEET_ACCOUNT);
  accountSheet.appendRow(["生徒ID", "生徒名", "生徒メールアドレス", "アカウント状態", "登録日", "初期パスワード"]);
  accountSheet.appendRow(["std_sample01", "サンプル太郎", "sample.taro@example.com", "有効", new Date().toLocaleString("ja-JP"), "sampl1"]);
  accountSheet.getRange("A1:F1").setFontWeight("bold").setBackground("#fee2e2");

  // 3. Student Profile Sheet (👥 生徒プロフィール)
  // パスワード等の認証情報を持つ「⚙️ アカウント設定」とは別シートにし、アルバイト講師が
  // 志望校・受験科目を見る/触るときにパスワード列に一切触れないようにしている。
  // 新規生徒は、このシートに生徒名・生徒メールアドレスだけを直接入力して1行追加し、
  // その行を選んで「選択した生徒にIDを発行する」を実行する(生徒ID列は発行時に自動で埋まる)。
  var profileSheet = ss.insertSheet(SHEET_PROFILE);
  var profileHeader = ["生徒ID", "生徒名", "生徒メールアドレス", "第一志望", "第二志望"].concat(STUDENT_PROFILE_SUBJECT_COLUMNS);
  profileSheet.appendRow(profileHeader);
  profileSheet.getRange(1, 1, 1, profileHeader.length).setFontWeight("bold").setBackground("#ede9fe");
  // 受験科目列はチェックボックスにしておく(後から追加される行の分もまとめて、
  // 200行分あらかじめ適用しておく。少人数の塾運用なら十分な余裕)。
  var subjectStartCol = 6; // F列から
  profileSheet.getRange(2, subjectStartCol, 200, STUDENT_PROFILE_SUBJECT_COLUMNS.length).insertCheckboxes();
  // サンプル生徒1: ID発行済み(数学IA・IIBと英語(高校)を受験科目として選択済み)
  var sampleSubjectValues = STUDENT_PROFILE_SUBJECT_COLUMNS.map(function (name) {
    return (name === "数学(高校IA)" || name === "数学(高校IIB)" || name === "英語(高校)");
  });
  profileSheet.getRange(2, 1, 1, 5 + sampleSubjectValues.length).setValues(
    [["std_sample01", "サンプル太郎", "sample.taro@example.com", "○○大学 工学部", "△△大学 理工学部"].concat(sampleSubjectValues)]
  );
  // サンプル生徒2: 生徒ID未発行(新規登録〜ID発行のフローをすぐ試せるように、
  // 生徒名・メールアドレスだけ入れた状態にしてある)
  profileSheet.getRange(3, 2, 1, 2).setValues([["サンプル花子", "sample.hanako@example.com"]]);

  // 5. Weekly Plan Sheet (📅 週間計画)
  // 生徒ごとに1行ずつ、週の計画を履歴として積んでいく(上書きではなく追記)。
  // 過去にどんな計画を立てていたかも遡って見られるようにするため。
  var weeklyPlanSheet = ss.insertSheet(SHEET_WEEKLY_PLAN);
  weeklyPlanSheet.appendRow(["記録日時", "対象週(開始日)", "生徒ID", "生徒名", "今週の計画", "担当講師", "備考"]);
  weeklyPlanSheet.appendRow([
    new Date().toLocaleString("ja-JP"), new Date().toLocaleDateString("ja-JP"),
    "std_sample01", "サンプル太郎",
    "青チャート数学IA 例題12〜20を解き直す。英単語ターゲット1900の001〜100を暗記。",
    "講師サンプル", "正答率が伸び悩んでいるため基礎の例題に戻した"
  ]);
  weeklyPlanSheet.getRange("A1:G1").setFontWeight("bold").setBackground("#fce7f3");

  // 6. Textbook Master Sheet (📖 参考書マスター)
  // 当初は問題を1問ずつ登録する形式だったが、1ページあたりの問題数が参考書ごとに不規則で
  // 範囲指定の一括登録ができず、重複登録や表記揺れも起きやすかった。参考書ごとに番号の付け方
  // (種別の有無・ページで区別するか)が違うことも踏まえ、問題そのものではなく参考書ごとの
  // 「記法の決まり」だけを登録する形式に変えた。
  var textbookMasterSheet = ss.insertSheet(SHEET_TEXTBOOK_MASTER);
  textbookMasterSheet.appendRow(["参考書名", "種別(カンマ区切り。無ければ空欄)", "ページを使う", "最大ページ(任意)", "備考"]);
  textbookMasterSheet.getRange(2, 3, 100, 1).insertCheckboxes();
  textbookMasterSheet.getRange(2, 1, 3, 5).setValues([
    ["青チャート数学IA", "例題,練習,EXERCISES", false, "", "種別+番号で問題を区別する例"],
    ["ターゲット1900", "", false, "", "単語番号だけで区別する例"],
    ["サンプル問題集", "基本,発展", true, 200, "ページ+番号で区別する例"]
  ]);
  textbookMasterSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#dcfce7");

  // 7. Answer Record Sheet (✅ 正答記録)
  // 生徒ごとに1行ずつ、参考書の問題を解いた結果(〇/△/×)を履歴として積んでいく。
  // 同じ問題を解き直した場合も上書きせず新しい行として追加する(いつ・何度目かが分かるように)。
  var answerRecordSheet = ss.insertSheet(SHEET_ANSWER_RECORD);
  answerRecordSheet.appendRow(["記録日時", "生徒ID", "生徒名", "参考書名", "種別", "ページ", "問題番号", "結果(〇/△/×)", "備考"]);
  var now = new Date().toLocaleString("ja-JP");
  answerRecordSheet.getRange("F:G").setNumberFormat("@"); // 「3-2」が日付に化けないように
  answerRecordSheet.getRange(2, 1, 4, 9).setValues([
    [now, "std_sample01", "サンプル太郎", "青チャート数学IA", "例題", "", "12", "〇", ""],
    [now, "std_sample01", "サンプル太郎", "青チャート数学IA", "例題", "", "13", "△", "計算ミスで途中まで合っていた"],
    [now, "std_sample01", "サンプル太郎", "ターゲット1900", "", "", "1", "〇", ""],
    [now, "std_sample01", "サンプル太郎", "サンプル問題集", "基本", "34", "3-2", "×", ""]
  ]);
  answerRecordSheet.getRange("A1:I1").setFontWeight("bold").setBackground("#d1fae5");
  // 結果列はプルダウンにして入力ゆれ(○と〇、×とばつ等)を防ぐ(ダイアログ・フォーム経由の入力でも
  // 結果は固定の3択から選ばせているが、直接セルを編集された場合の保険として残してある)
  var resultRule = SpreadsheetApp.newDataValidation().requireValueInList(["〇", "△", "×"], true).setAllowInvalid(false).build();
  answerRecordSheet.getRange(2, 8, 200, 1).setDataValidation(resultRule);

  // 8. Answer Rate Summary Sheet (📈 正答率サマリー) — 見出しだけ作る。中身はrunUpdateAnswerRateSummaryで生成
  var answerSummarySheet = ss.insertSheet(SHEET_ANSWER_SUMMARY);
  answerSummarySheet.appendRow(["生徒ID", "生徒名", "参考書名", "記録数", "〇の数", "正答率"]);
  answerSummarySheet.getRange("A1:F1").setFontWeight("bold").setBackground("#bbf7d0");

  // 8b. Problem Status Sheet (📊 問題別正答状況) — 中身はrunUpdateAnswerRateSummaryで生成
  var problemStatusSheet = ss.insertSheet(SHEET_PROBLEM_STATUS);
  writeProblemStatusHeader(problemStatusSheet);

  // 9. Tutor Advice Sheet (📣 講師アドバイス)
  var adviceSheet = ss.insertSheet(SHEET_ADVICE);
  adviceSheet.appendRow(["記録日時", "生徒ID", "生徒名", "アドバイス内容", "担当講師"]);
  adviceSheet.appendRow([
    new Date().toLocaleString("ja-JP"), "std_sample01", "サンプル太郎",
    "二次関数の最大最小は、まず軸の位置で場合分けする癖をつけよう。来週は場合分けの練習問題を中心に。",
    "講師サンプル"
  ]);
  adviceSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#fef9c3");

  // ダミーシート削除
  ss.deleteSheet(dummy);

  ui.alert("完了", "システムのスプレッドシート構造をサンプルデータ付きで再構築しました。README シートを確認してください。", ui.ButtonSet.OK);
}

// ============================================
// 3. Issue Student ID (生徒IDの発行)
// ============================================
// 「👥 生徒プロフィール」シートで、生徒名・生徒メールアドレスだけを入力した行(生徒ID列は
// まだ空)を選択した状態でメニューから実行する。生徒ID・初期パスワードを発行し、
// 「⚙️ アカウント設定」への登録とメール送信までをスプレッドシート単体で完結させる。
function issueStudentId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_PROFILE) {
    ui.alert("エラー", "「" + SHEET_PROFILE + "」シートを開いた状態で、IDを発行したい生徒の行のセルを選択して実行してください。", ui.ButtonSet.OK);
    return;
  }

  var activeCell = sheet.getActiveCell();
  var row = activeCell.getRow();

  if (row <= 1) {
    ui.alert("エラー", "IDを発行する生徒の行を選択してください（見出し行は選択不可）。", ui.ButtonSet.OK);
    return;
  }

  var values = sheet.getRange(row, 1, 1, 3).getValues()[0];
  var existingId = values[0].toString().trim();
  var studentName = values[1].toString().trim();
  var email = values[2].toString().trim();

  if (existingId) {
    ui.alert("エラー", "この行の生徒にはすでに生徒ID (" + existingId + ") が発行されています。", ui.ButtonSet.OK);
    return;
  }

  if (!studentName || !email) {
    ui.alert("エラー", "選択された行の生徒名または生徒メールアドレスが空です。先に入力してから実行してください。", ui.ButtonSet.OK);
    return;
  }

  var confirmResp = ui.alert("確認", "生徒「" + studentName + " (メール: " + email + ")」に個別生徒IDを発行して案内メールを送信します。よろしいですか？", ui.ButtonSet.OK_CANCEL);
  if (confirmResp !== ui.Button.OK) return;

  // 生徒固有ID (推測困難なランダム8文字) の生成
  var studentId = "std_" + generateRandomId(8);
  // ログイン用の5桁の初期パスワードを生成
  var initPassword = generateRandomId(5);

  // ⚙️ アカウント設定シートに登録
  var accountSheet = ss.getSheetByName(SHEET_ACCOUNT);
  accountSheet.appendRow([studentId, studentName, email, "有効", new Date().toLocaleString("ja-JP"), initPassword]);

  // 👥 生徒プロフィールのA列(生徒ID)に発行したIDを書き込む
  sheet.getRange(row, 1).setValue(studentId);

  // 生徒への通知メール作成と送信
  // 生徒がIDを使うのは正答記録フォームだけなので、フォームが作成済みならそのURLも載せる
  var formUrl = getAnswerRecordFormUrl();
  var subject = MAIL_SUBJECT_PREFIX + "生徒IDのご案内";
  var body = studentName + " 様\n\n" +
             "学習管理システムへの登録が完了しました。\n" +
             "参考書の問題を解いたら、正答記録フォームから結果を記録してください。\n" +
             "フォームでは、最初に以下の生徒IDを入力します。\n\n" +
             "-----------------------------------------\n" +
             "■ 生徒ID: " + studentId + "\n" +
             (formUrl ? "■ 正答記録フォーム: " + formUrl + "\n" : "") +
             "-----------------------------------------\n\n" +
             "※ 生徒IDはあなた専用です。他の人に教えないでください。\n" +
             "※ 講師からのアドバイスも、このメールアドレスに届きます。\n\n" +
             "-----------------------------------------\n" +
             "※本メールは自動送信されています。";

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: body
  });

  ui.alert("成功", "生徒「" + studentName + "」にID (" + studentId + ") と初期パスワード (" + initPassword + ") をメール送信しました。", ui.ButtonSet.OK);
}

// 生徒プロフィールから生徒名を完全一致で検索する共通ヘルパー。
// (塾長・講師がスプレッドシート側のダイアログで使う。プルダウンから選ぶので表記ゆれは無い)
function findStudentByName(ss, inputName) {
  var profileSheet = ss.getSheetByName(SHEET_PROFILE);
  if (!profileSheet) return null;

  var profileRows = profileSheet.getDataRange().getValues();
  for (var i = 1; i < profileRows.length; i++) {
    if (profileRows[i][1] && profileRows[i][1].toString().trim() === inputName) {
      return { id: profileRows[i][0], name: profileRows[i][1], email: profileRows[i][2] };
    }
  }
  return null;
}

// 生徒プロフィールから生徒IDを完全一致で検索する共通ヘルパー。
// (生徒向けGoogleフォームで使う。名前のプルダウンだと誰でも他の生徒になりすまして提出
// できてしまうため、本人しか知らない生徒ID(発行時のメールにのみ記載)の入力を必須にしている)
function findStudentById(ss, inputId) {
  var profileSheet = ss.getSheetByName(SHEET_PROFILE);
  if (!profileSheet) return null;

  var profileRows = profileSheet.getDataRange().getValues();
  for (var i = 1; i < profileRows.length; i++) {
    if (profileRows[i][0] && profileRows[i][0].toString().trim() === inputId) {
      return { id: profileRows[i][0], name: profileRows[i][1], email: profileRows[i][2] };
    }
  }
  return null;
}

// ============================================
// 4. 記録ダイアログ(HtmlService)
// ============================================
// 当初は ui.prompt() を生徒名→内容→担当講師の順に連続表示していたが、ダイアログが
// 出ては消え出ては消えるのが使いにくいという指摘を受け、1画面にまとめたフォーム
// (HtmlService)に置き換えた。Webアプリとしてのデプロイは不要で、スプレッドシートに
// 紐づいたApps Scriptの中だけで完結する(google.script.runでサーバー側関数を呼ぶだけ)。
// 新規に入力を集めるだけのフォームで、蓄積済みデータをHTMLへそのまま埋め込んで表示する
// 処理は無いため、XSS等の懸念も特に無い。
function showWeeklyPlanDialog() {
  var html = HtmlService.createHtmlOutputFromFile('WeeklyPlanDialog').setWidth(400).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '今週の計画を記録する');
}

function showAnswerRecordDialog() {
  var html = HtmlService.createHtmlOutputFromFile('AnswerRecordDialog').setWidth(400).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '正答記録を入力する');
}

function showTutorAdviceDialog() {
  var html = HtmlService.createHtmlOutputFromFile('TutorAdviceDialog').setWidth(400).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, '講師アドバイスを記録する');
}

// ダイアログ側(google.script.run)から呼ばれる。👥 生徒プロフィールの生徒名一覧を返す。
function getStudentNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var profileSheet = ss.getSheetByName(SHEET_PROFILE);
  if (!profileSheet) return [];

  var rows = profileSheet.getRange(1, 1, profileSheet.getMaxRows(), 2).getValues();
  var names = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] !== "" && rows[i][0] !== null) names.push(rows[i][1]);
  }
  return names;
}

// 📖 参考書マスターから参考書ごとの記法の決まりを返す。
// ダイアログ側(google.script.run)からも呼ばれ、種別の選択肢やページ欄の表示切替に使う。
// フォーム送信トリガーからはアクティブなスプレッドシートが取れないため、ssを渡せるようにしている。
function getTextbookMasterData(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName(SHEET_TEXTBOOK_MASTER);
  if (!masterSheet) return [];

  var rows = masterSheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var book = (rows[i][0] || "").toString().trim();
    if (!book) continue;
    var types = (rows[i][1] || "").toString().split(/[,、，]/)
        .map(function (t) { return t.trim(); })
        .filter(function (t) { return t; });
    var maxPage = parseInt(normalizeDigits((rows[i][3] || "").toString()), 10);
    out.push({ book: book, types: types, usesPage: rows[i][2] === true, maxPage: isNaN(maxPage) ? null : maxPage });
  }
  return out;
}

// 正答記録への追記はすべてここを通す。「3-2」のような問題番号はそのまま書くと
// スプレッドシートが日付(3月2日)に自動変換してしまう。appendRowは書式なしテキストに
// 固定した列でも変換してしまった(実機で確認)ため、行を指定してsetValuesで書く。
function appendAnswerRecord(recordSheet, row) {
  var r = recordSheet.getLastRow() + 1;
  recordSheet.getRange(r, 6, 1, 2).setNumberFormat("@");
  recordSheet.getRange(r, 1, 1, row.length).setValues([row]);
}

function getTextbookRule(rules, book) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].book === book) return rules[i];
  }
  return null;
}

function normalizeDigits(s) {
  return s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}

// 空欄なら""、数字として読めなければnull、読めれば先頭の0を除いた数字の文字列を返す。
function normalizePage(s) {
  var t = normalizeDigits((s || "").toString()).replace(/\s/g, "").replace(/^[pPｐＰ]\.?/, "");
  if (!t) return "";
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : null;
}

// 「大問-小問-小小問」(後ろ2つは省略可)に揃える。形式に合わなければnullを返す。
// 「3-02」と「3-2」が別の問題として集計されないよう、各部分の先頭の0も除く。
function normalizeProblemNumber(s) {
  var parts = normalizeDigits((s || "").toString()).replace(/\s/g, "").split(/[-－ー‐−]/);
  if (parts.length > 3) return null;
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return null;
    parts[i] = String(parseInt(parts[i], 10));
  }
  return parts.join("-");
}

// 参考書ごとの決まりに照らした問題点を文章の配列で返す(問題が無ければ空配列)。
// page/problemNumは正規化済みの値(normalizePage/normalizeProblemNumberの戻り値)を渡す。
function checkProblemEntry(rule, type, page, problemNum) {
  if (!rule) return ["参考書マスターに無い参考書です"];
  var problems = [];
  if (rule.types.length && rule.types.indexOf(type) === -1) {
    problems.push("種別は「" + rule.types.join("・") + "」から選んでください");
  }
  if (!rule.types.length && type) problems.push("この参考書には種別がありません");
  if (page === null) {
    problems.push("ページは数字で入力してください");
  } else if (rule.usesPage && page === "") {
    problems.push("この参考書はページの入力が必要です");
  } else if (!rule.usesPage && page !== "") {
    problems.push("この参考書はページを使いません");
  } else if (rule.maxPage && page !== "" && Number(page) > rule.maxPage) {
    problems.push("ページが最大ページ(" + rule.maxPage + ")を超えています");
  }
  if (problemNum === null) {
    problems.push("問題番号は「大問-小問-小小問」の形式で入力してください(例: 12、3-2、3-2-1)");
  }
  return problems;
}

// 以下3つはダイアログのフォーム送信から呼ばれる。例外を投げると
// ダイアログ側のwithFailureHandlerに渡り、画面にエラー表示される。
function submitWeeklyPlan(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var planSheet = ss.getSheetByName(SHEET_WEEKLY_PLAN);
  var student = findStudentByName(ss, data.studentName);
  if (!student) throw new Error('生徒「' + data.studentName + '」が見つかりません。');

  planSheet.appendRow([
    new Date().toLocaleString("ja-JP"),
    new Date().toLocaleDateString("ja-JP"),
    student.id,
    student.name,
    data.planText,
    data.tutorName,
    ""
  ]);
}

function submitAnswerRecord(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var recordSheet = ss.getSheetByName(SHEET_ANSWER_RECORD);
  var student = findStudentByName(ss, data.studentName);
  if (!student) throw new Error('生徒「' + data.studentName + '」が見つかりません。');
  if (data.result !== "〇" && data.result !== "△" && data.result !== "×") {
    throw new Error('結果は「〇」「△」「×」のいずれかで指定してください。');
  }
  // 講師の入力は、決まりに合わなければその場で弾いて直してもらう
  // (生徒のフォーム入力は弾けないため、記録したうえで備考に要確認と残す)。
  var type = data.type || "";
  var page = normalizePage(data.page);
  var problemNum = normalizeProblemNumber(data.problemNum);
  var problems = checkProblemEntry(getTextbookRule(getTextbookMasterData(), data.book), type, page, problemNum);
  if (problems.length) throw new Error(problems.join("\n"));

  appendAnswerRecord(recordSheet, [
    new Date().toLocaleString("ja-JP"),
    student.id,
    student.name,
    data.book,
    type,
    page,
    problemNum,
    data.result,
    ""
  ]);
}

// 記録と同時にメールで本人へ通知する。生徒はこのスプレッドシートを(他の生徒の個人情報が
// 見えてしまうため)直接閲覧できない前提のため、講師アドバイスを生徒に届ける経路として、
// 記録直後にメール送信する。
function submitTutorAdvice(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var adviceSheet = ss.getSheetByName(SHEET_ADVICE);
  var student = findStudentByName(ss, data.studentName);
  if (!student) throw new Error('生徒「' + data.studentName + '」が見つかりません。');

  adviceSheet.appendRow([
    new Date().toLocaleString("ja-JP"),
    student.id,
    student.name,
    data.adviceText,
    data.tutorName
  ]);

  if (student.email) {
    var subject = MAIL_SUBJECT_PREFIX + "講師からのアドバイス";
    var body = student.name + " 様\n\n" +
               (data.tutorName || "担当講師") + "からアドバイスが届きました。\n\n" +
               "-----------------------------------------\n" +
               data.adviceText + "\n" +
               "-----------------------------------------\n\n" +
               "次回の面談でも、内容を一緒に確認しましょう。\n\n" +
               "-----------------------------------------\n" +
               "※本メールは自動送信されています。";
    MailApp.sendEmail({ to: student.email, subject: subject, body: body });
  }
}

// ランダム英数字ID生成ヘルパー
function generateRandomId(length) {
  var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var result = "";
  for (var i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================
// 5. 生徒向け正答記録フォーム(Googleフォーム連携)
// ============================================
// 「正答記録を入力する」(showAnswerRecordDialog)はスプレッドシートを開ける塾長・講師しか
// 実行できないため、生徒自身が自分の正答記録を入力する経路が無い、という指摘を受けて追加した。
// 生徒にスプレッドシートの編集権限を直接与える案は、同じスプレッドシート内の他の生徒の個人情報
// (⚙️ アカウント設定のパスワード等)まで見えてしまうため避け、代わりに入力項目を絞った
// Googleフォームを生徒に配布する方式にした。フォームの回答はこのスプレッドシートに自動で溜まり
// (📨 正答記録フォーム回答)、フォーム送信をトリガーに自動で✅正答記録へ転記する
// (onAnswerRecordFormSubmit)。生徒の特定は生徒名のプルダウンではなく生徒ID(発行時のメールに
// のみ記載、本人しか知らないはず)の記述式入力にしており、他の生徒になりすましての提出を
// 防いでいる(メールアドレス必須化の方がより確実だが、生徒が入力を嫌って使わなくなるリスクが
// あるため、この折衷案を採用した)。
//
// 注意: この関数(FormAppでのフォーム作成・ScriptAppでのトリガー登録)を初めて実行する際、
// 「正答記録を入力する」等の既存メニューより広い権限(フォームの管理・トリガーの管理)への
// 追加の承認画面が表示されることがある。
// 指定タイトルの質問をタイプごとに探し、無ければ新規作成するヘルパー群。
// 質問を削除して作り直すと回答シートに重複列が増殖する問題があったため、
// setupAnswerRecordFormの再実行時もこれらを使って既存の質問を再利用する。
function findOrCreateListItem(form, title) {
  var items = form.getItems(FormApp.ItemType.LIST);
  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle() === title) return items[i].asListItem();
  }
  return form.addListItem().setTitle(title);
}

function findOrCreateTextItem(form, title) {
  var items = form.getItems(FormApp.ItemType.TEXT);
  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle() === title) return items[i].asTextItem();
  }
  return form.addTextItem().setTitle(title);
}

function findOrCreateMultipleChoiceItem(form, title) {
  var items = form.getItems(FormApp.ItemType.MULTIPLE_CHOICE);
  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle() === title) return items[i].asMultipleChoiceItem();
  }
  return form.addMultipleChoiceItem().setTitle(title);
}

function setupAnswerRecordForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty(FORM_ID_PROPERTY_KEY);
  var form = null;

  if (formId) {
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      form = null; // 手動で削除された等、IDが無効になっていた場合は作り直す
    }
  }

  if (!form) {
    form = FormApp.create("正答記録の入力フォーム");
    form.setCollectEmail(false);
    props.setProperty(FORM_ID_PROPERTY_KEY, form.getId());
  }
  // 説明文は再実行のたびに更新する(初回作成時だけでなく、文言修正を反映できるように)。
  form.setDescription(
    "参考書の問題を解いたら、その都度このフォームから記録してください。\n" +
    "「生徒ID」は、利用登録時に届いたメールに記載されている英数字のIDです" +
    "(他の生徒になりすまして提出できないよう、名前の選択式ではなくIDの入力にしています)。"
  );

  var rules = getTextbookMasterData();
  var bookNames = rules.map(function (r) { return r.book; });
  // Googleフォームは前の回答に応じて選択肢を絞り込めないため、種別は全参考書分の和集合を出し、
  // 参考書に合っているかは送信後にcheckProblemEntryで確認する。
  var allTypes = [];
  rules.forEach(function (r) {
    r.types.forEach(function (t) { if (allTypes.indexOf(t) === -1) allTypes.push(t); });
  });

  // 生徒・参考書が増えるたびに選択肢を最新化する必要があるが、当初は既存の質問をいったん
  // 全削除してから作り直す方式にしていた。これは実機で2つの問題を起こすことが分かった:
  // ①フォームにリンクされた回答シートには、削除された質問の列がそのまま残り、新しい質問の
  // 列が末尾に追加される(重複ヘッダーが増殖し続ける)。②ヘッダー名が重複すると、
  // onAnswerRecordFormSubmitが受け取るe.namedValuesの値が壊れる(新しい列の値ではなく、
  // 使われなくなった古い列の空値を拾ってしまい、生徒名等が空のまま記録されてしまう)。
  // そのため、既存の質問をタイトルで探して選択肢だけ更新する方式に変更した(質問オブジェクト
  // 自体は作り直さないので、回答シートの列も増えない)。
  //
  // 「生徒名」のプルダウン選択式だと、誰でも他の生徒の名前を選んで成り代わって提出できて
  // しまう(回答に認証が無いため)。メールアドレス必須にする案は確実だが、生徒が入力を嫌って
  // 使わなくなるリスクがあるため、折衷案として「生徒ID」(発行時のメールにのみ記載される、
  // 本人しか知らないはずの文字列)を記述式で入力させる方式にした。
  var idItem = findOrCreateTextItem(form, "生徒ID")
      .setHelpText("利用登録時に届いたメールに記載されている生徒IDを入力してください(例: std_XXXXXXXX)。")
      .setRequired(true);

  var bookItem = findOrCreateListItem(form, "参考書名")
      .setChoiceValues(bookNames.length ? bookNames : ["(参考書マスターが空です。先に参考書を登録してください)"])
      .setRequired(true);

  var typeItem = findOrCreateListItem(form, "種別")
      .setHelpText("例題・練習などの区別がある参考書だけ選んでください。区別の無い参考書は空欄のままで構いません。")
      .setChoiceValues(allTypes.length ? allTypes : [NO_TYPE_LABEL])
      .setRequired(false);

  var pageItem = findOrCreateTextItem(form, "ページ")
      .setHelpText("ページで問題を区別する参考書だけ、ページ番号を数字で入力してください。")
      .setValidation(FormApp.createTextValidation()
          .setHelpText("ページは数字で入力してください(例: 34)。")
          .requireTextMatchesPattern(PAGE_PATTERN)
          .build())
      .setRequired(false);

  // 問題番号の候補は無数にあり選択式にできないため記述式にし、形式だけを入力時に検査する。
  var numberItem = findOrCreateTextItem(form, "問題番号")
      .setHelpText("「大問-小問-小小問」の形式で入力してください。小問・小小問は省略できます(例: 12、3-2、3-2-1)。")
      .setValidation(FormApp.createTextValidation()
          .setHelpText("「大問-小問-小小問」の形式で入力してください(例: 12、3-2、3-2-1)。")
          .requireTextMatchesPattern(PROBLEM_NUMBER_PATTERN)
          .build())
      .setRequired(true);

  var resultItem = findOrCreateMultipleChoiceItem(form, "結果")
      .setChoiceValues(["〇", "△", "×"])
      .setRequired(true);

  // 後から追加した質問は末尾に付くため、表示順を毎回そろえ直す
  [idItem, bookItem, typeItem, pageItem, numberItem, resultItem].forEach(function (item, i) {
    form.moveItem(item.getIndex(), i);
  });

  // 作成直後のフォームは応答先が一度も設定されていないため、getDestinationId()が
  // nullではなく例外("フォームに応答先がありません")を投げることがある(既知の挙動)。
  var currentDestinationId = null;
  try {
    currentDestinationId = form.getDestinationId();
  } catch (e) {
    currentDestinationId = null;
  }
  if (currentDestinationId !== ss.getId()) {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  }

  // フォームの回答シートが生成されたら、分かりやすい名前に変更する
  var formSheet = findFormResponseSheet(ss, form);
  if (formSheet && formSheet.getName() !== SHEET_FORM_RESPONSES) {
    try {
      formSheet.setName(SHEET_FORM_RESPONSES);
    } catch (e) {
      // 既に同名のシートがある等で改名できない場合はそのままにする(機能上の支障はない)
    }
  }

  // フォーム送信トリガーを設定し直す。
  // フォーム自体のトリガー(forForm)にして、生徒が入力した文字列をe.responseからそのまま読む。
  // スプレッドシートのトリガー(forSpreadsheet)のe.namedValuesは回答シートに書かれた後の値で、
  // 「4-5-5」が日付(2004/5/5)に変換された状態で届いてしまった(実機で確認)。
  // フォームのトリガーからはアクティブなスプレッドシートが取れないため、IDを保存しておく。
  props.setProperty(SPREADSHEET_ID_PROPERTY_KEY, ss.getId());
  var existingTriggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === "onAnswerRecordFormSubmit" && t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
  });
  existingTriggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onAnswerRecordFormSubmit").forForm(form).onFormSubmit().create();

  // ⚙️ システム設定にフォームURLを記録しておく(無ければ行を追加、あれば更新)
  var configSheet = ss.getSheetByName(SHEET_CONFIG);
  var formUrl = form.getPublishedUrl();
  var configRows = configSheet.getDataRange().getValues();
  var urlRow = -1;
  for (var r = 1; r < configRows.length; r++) {
    if (configRows[r][0] === "生徒向け正答記録フォームURL") { urlRow = r + 1; break; }
  }
  if (urlRow === -1) {
    configSheet.appendRow(["生徒向け正答記録フォームURL", formUrl, "生徒に配布するフォームのURL(このメニューを再実行すると選択肢が最新化される)"]);
  } else {
    configSheet.getRange(urlRow, 2).setValue(formUrl);
  }

  ui.alert(
    "完了",
    "生徒向け正答記録フォームを作成/更新しました。\n\n" +
    "URL: " + formUrl + "\n\n" +
    "このURLを生徒に配布してください(「⚙️ システム設定」シートにも記録してあります)。\n" +
    "生徒や参考書を追加したときは、このメニューを再実行して選択肢を最新化してください。",
    ui.ButtonSet.OK
  );
}

// フォームにリンクされた回答シートを、このスプレッドシート内から探す。
function findFormResponseSheet(ss, form) {
  var sheets = ss.getSheets();
  var formUrl = form.getPublishedUrl();
  for (var i = 0; i < sheets.length; i++) {
    try {
      if (sheets[i].getFormUrl() === formUrl) return sheets[i];
    } catch (e) {
      // フォームにリンクされていないシートで例外になることがあるため無視して次へ
    }
  }
  return null;
}

// Googleフォームの送信時に自動実行される(setupAnswerRecordFormが設定するフォームのトリガー経由)。
// e.responseから、質問タイトルごとに生徒が入力した文字列をそのまま取り出す。
function onAnswerRecordFormSubmit(e) {
  if (!e || !e.response) return;
  var ssId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY_KEY);
  var ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.getActiveSpreadsheet();
  var recordSheet = ss.getSheetByName(SHEET_ANSWER_RECORD);
  if (!recordSheet) return;

  // 任意の質問に答えなかった場合、その質問はgetItemResponses()に含まれない
  var answers = {};
  e.response.getItemResponses().forEach(function (r) {
    answers[r.getItem().getTitle()] = r.getResponse();
  });
  function answer(title) {
    var v = answers[title];
    return (v === undefined || v === null ? "" : v).toString().trim();
  }
  var studentId = answer("生徒ID");
  var book = answer("参考書名");
  var type = answer("種別") === NO_TYPE_LABEL ? "" : answer("種別");
  var rawPage = answer("ページ");
  var rawNumber = answer("問題番号");
  var result = answer("結果");

  var student = findStudentById(ss, studentId);
  var notes = [];
  if (!student) notes.push("生徒IDが生徒プロフィールと一致しない: 「" + studentId + "」");

  // フォームでは参考書ごとの決まりを入力時に強制できないため、決まりに合わない回答も
  // データは取りこぼさず記録し、備考に要確認と残すだけに留める。
  var page = normalizePage(rawPage);
  var problemNum = normalizeProblemNumber(rawNumber);
  notes = notes.concat(checkProblemEntry(getTextbookRule(getTextbookMasterData(ss), book), type, page, problemNum));

  appendAnswerRecord(recordSheet, [
    new Date().toLocaleString("ja-JP"),
    student ? student.id : "",
    student ? student.name : "",
    book,
    type,
    page === null ? rawPage : page,
    problemNum === null ? rawNumber : problemNum,
    result,
    notes.length ? "フォーム経由 / 要確認: " + notes.join(" / ") : "フォーム経由"
  ]);
}

// ============================================
// 6. Update Answer Rate Summary (正答率サマリーの再構築)
// ============================================
// 「✅ 正答記録」を生徒×参考書ごとに集計する。シート名に絵文字を含むため、数式(QUERY等)での
// 参照は壊れやすく、スクリプト側で集計した方が確実なのでこちらを採用している。
function runUpdateAnswerRateSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  updateAnswerRateSummary(ss);
  updateProblemStatus(ss);
  SpreadsheetApp.getUi().alert("完了", "正答率サマリーと問題別正答状況を再構築しました。", SpreadsheetApp.getUi().ButtonSet.OK);
}

function updateAnswerRateSummary(ss) {
  var summarySheet = ss.getSheetByName(SHEET_ANSWER_SUMMARY);
  var recordSheet = ss.getSheetByName(SHEET_ANSWER_RECORD);
  if (!summarySheet || !recordSheet) return;

  summarySheet.clear();
  summarySheet.appendRow(["生徒ID", "生徒名", "参考書名", "記録数", "〇の数", "正答率"]);
  summarySheet.getRange("A1:F1").setFontWeight("bold").setBackground("#bbf7d0");

  var rows = recordSheet.getDataRange().getValues();
  var groups = {}; // key: 生徒ID + "||" + 参考書名
  var order = []; // 出現順を保つため

  for (var i = 1; i < rows.length; i++) {
    var studentId = rows[i][1];
    var studentName = rows[i][2];
    var book = rows[i][3];
    var result = (rows[i][7] || "").toString().trim();
    if (!studentId || !book) continue;

    var key = studentId + "||" + book;
    if (!groups[key]) {
      groups[key] = { studentId: studentId, studentName: studentName, book: book, total: 0, correct: 0 };
      order.push(key);
    }
    groups[key].total++;
    if (result === "〇") groups[key].correct++;
  }

  var output = [];
  for (var k = 0; k < order.length; k++) {
    var g = groups[order[k]];
    var ratePercent = g.total > 0 ? Math.round((g.correct / g.total) * 100) : 0;
    output.push([g.studentId, g.studentName, g.book, g.total, g.correct, ratePercent + "%"]);
  }

  if (output.length > 0) {
    summarySheet.getRange(2, 1, output.length, 6).setValues(output);
  }
}

// ============================================
// 7. 問題別正答状況(面談用の一覧)
// ============================================
// 正答率サマリーは参考書全体の割合しか分からず、「問題1は△、問題2は〇」のように面談で
// 一目で見たいという要件を満たせなかったため追加した。生徒×問題ごとに最新の結果を1行にまとめる。
function writeProblemStatusHeader(sheet) {
  sheet.appendRow(["生徒ID", "生徒名", "参考書名", "種別", "ページ", "問題番号", "最新結果", "記録回数", "最新記録日時"]);
  sheet.getRange("A1:I1").setFontWeight("bold").setBackground("#fde68a");
}

function updateProblemStatus(ss) {
  var statusSheet = ss.getSheetByName(SHEET_PROBLEM_STATUS);
  var recordSheet = ss.getSheetByName(SHEET_ANSWER_RECORD);
  if (!statusSheet || !recordSheet) return;

  statusSheet.clear();
  writeProblemStatusHeader(statusSheet);

  var rows = recordSheet.getDataRange().getValues();
  var groups = {};
  var keys = [];
  for (var i = 1; i < rows.length; i++) {
    var studentId = rows[i][1];
    var book = rows[i][3];
    var problemNum = rows[i][6].toString();
    if (!studentId || !book || !problemNum) continue;

    var key = [studentId, book, rows[i][4], rows[i][5], problemNum].join("||");
    if (!groups[key]) {
      groups[key] = { row: [studentId, rows[i][2], book, rows[i][4], rows[i][5], problemNum], count: 0 };
      keys.push(key);
    }
    // 正答記録は追記のみで下の行ほど新しいため、後から出てきた結果で上書きすれば最新になる
    groups[key].count++;
    groups[key].latestResult = rows[i][7];
    groups[key].latestAt = rows[i][0];
  }
  if (!keys.length) return;

  var output = keys.map(function (k) {
    var g = groups[k];
    return g.row.concat([g.latestResult, g.count, g.latestAt]);
  });
  output.sort(compareProblemStatusRows);
  statusSheet.getRange("E:F").setNumberFormat("@"); // 「3-2」が日付に化けないように
  statusSheet.getRange(2, 1, output.length, 9).setValues(output);

  // 面談で×と△がすぐ目に入るよう、最新結果の列だけ色を付ける
  var colors = { "〇": "#dcfce7", "△": "#fef9c3", "×": "#fee2e2" };
  statusSheet.getRange(2, 7, output.length, 1).setBackgrounds(output.map(function (r) {
    return [colors[r[6]] || null];
  }));
}

// 生徒→参考書→種別→ページ→問題番号の順に並べる。ページと問題番号は数値として比べる
// (文字列のままだと「10」が「9」より前に来てしまうため)。
function compareProblemStatusRows(a, b) {
  for (var i = 0; i < 3; i++) {
    var c = String(a[i] === undefined ? "" : a[i]).localeCompare(String(b[i] === undefined ? "" : b[i]));
    if (c !== 0) return c;
  }
  var pageDiff = (Number(a[4]) || 0) - (Number(b[4]) || 0);
  if (pageDiff !== 0) return pageDiff;
  var pa = String(a[5]).split("-");
  var pb = String(b[5]).split("-");
  for (var j = 0; j < Math.max(pa.length, pb.length); j++) {
    var d = (Number(pa[j]) || 0) - (Number(pb[j]) || 0);
    if (d !== 0) return d;
  }
  return 0;
}

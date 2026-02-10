function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('projectC - サッカー同好会出欠管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const doc = SpreadsheetApp.getActiveSpreadsheet();
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result = {};

    switch (action) {
      case 'get_initial_data':
        result = handleGetInitialData(doc);
        break;
      case 'add_member':
        result = handleAddMember(doc, data);
        break;
      case 'update_member':
        result = handleUpdateMember(doc, data);
        break;
      case 'delete_member':
        result = handleDeleteMember(doc, data);
        break;
      case 'add_event':
        result = handleAddEvent(doc, data);
        break;
      case 'update_event':
        result = handleUpdateEvent(doc, data);
        break;
      case 'delete_event':
        result = handleDeleteEvent(doc, data);
        break;
      case 'add_period':
        result = handleAddPeriod(doc, data);
        break;
      case 'update_period':
        result = handleUpdatePeriod(doc, data);
        break;
      case 'delete_period':
        result = handleDeletePeriod(doc, data);
        break;
      case 'update_attendance':
        result = handleUpdateAttendance(doc, data);
        break;
      case 'setup':
        result = setup();
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    return ContentService.createTextOutput(JSON.stringify({ result: 'success', data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 初期データの取得
 */
function handleGetInitialData(doc) {
  return {
    periods: getSheetData(doc, 'Periods'),
    members: getSheetData(doc, 'Members'),
    events: getSheetData(doc, 'Events'),
    attendance: getAttendanceData(doc)
  };
}

function getSheetData(doc, sheetName) {
  const sheet = doc.getSheetByName(sheetName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      // Convert Date types to YYYY-MM-DD string for consistency
      if (val instanceof Date) {
        val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd");
      }
      obj[h.toLowerCase()] = val;
    });
    return obj;
  });
}

function getAttendanceData(doc) {
  const sheet = doc.getSheetByName('Attendance');
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return {};
  
  let data = {};
  for (let i = 1; i < rows.length; i++) {
    const [eventId, memberId, status, comment] = rows[i];
    const key = `${eventId}_${memberId}`;
    data[key] = { status, comment };
  }
  return data;
}

/**
 * 期間関連
 */
function handleAddPeriod(doc, data) {
  let sheet = doc.getSheetByName('Periods') || doc.insertSheet('Periods');
  if (sheet.getLastRow() === 0) sheet.appendRow(['Id', 'Name', 'StartDate', 'EndDate']);
  sheet.appendRow([data.id, data.name, data.startDate, data.endDate]);
  return { success: true };
}

function handleUpdatePeriod(doc, data) {
  const sheet = doc.getSheetByName('Periods');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[data.name, data.startDate, data.endDate]]);
      return { success: true };
    }
  }
  return { success: false };
}

function handleDeletePeriod(doc, data) {
  const sheet = doc.getSheetByName('Periods');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}

/**
 * メンバー関連
 */
function handleAddMember(doc, data) {
  let sheet = doc.getSheetByName('Members') || doc.insertSheet('Members');
  if (sheet.getLastRow() === 0) sheet.appendRow(['Id', 'Name', 'Affiliation', 'JoinMonth', 'LeaveMonth']);
  sheet.appendRow([data.id, data.name, data.affiliation || '', data.joinMonth || '', data.leaveMonth || '']);
  return { success: true };
}

function handleUpdateMember(doc, data) {
  const sheet = doc.getSheetByName('Members');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 2, 1, 4).setValues([[data.name, data.affiliation || '', data.joinMonth || '', data.leaveMonth || '']]);
      return { success: true };
    }
  }
  return { success: false };
}

function handleDeleteMember(doc, data) {
  const sheet = doc.getSheetByName('Members');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  // 出欠データも削除
  const attSheet = doc.getSheetByName('Attendance');
  if (attSheet) {
    const attRows = attSheet.getDataRange().getValues();
    for (let i = attRows.length - 1; i >= 1; i--) {
      if (String(attRows[i][1]) === String(data.id)) attSheet.deleteRow(i + 1);
    }
  }
  return { success: true };
}

/**
 * イベント関連
 */
function handleAddEvent(doc, data) {
  let sheet = doc.getSheetByName('Events') || doc.insertSheet('Events');
  if (sheet.getLastRow() === 0) sheet.appendRow(['Id', 'Date', 'Time', 'Location', 'Title', 'Note']);
  sheet.appendRow([data.id, data.date, data.time, data.location, data.title, data.note || '']);
  return { success: true };
}

function handleUpdateEvent(doc, data) {
  const sheet = doc.getSheetByName('Events');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 2, 1, 5).setValues([[data.date, data.time, data.location, data.title, data.note || '']]);
      return { success: true };
    }
  }
  return { success: false };
}

function handleDeleteEvent(doc, data) {
  const sheet = doc.getSheetByName('Events');
  if (!sheet) return { success: false };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  // 出欠データも削除
  const attSheet = doc.getSheetByName('Attendance');
  if (attSheet) {
    const attRows = attSheet.getDataRange().getValues();
    for (let i = attRows.length - 1; i >= 1; i--) {
      if (String(attRows[i][0]) === String(data.id)) attSheet.deleteRow(i + 1);
    }
  }
  return { success: true };
}

/**
 * 出欠登録
 */
function handleUpdateAttendance(doc, data) {
  let sheet = doc.getSheetByName('Attendance') || doc.insertSheet('Attendance');
  if (sheet.getLastRow() === 0) sheet.appendRow(['EventID', 'MemberID', 'Status', 'Comment', 'Timestamp']);
  
  const rows = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.eventId) && String(rows[i][1]) === String(data.memberId)) {
      rowIndex = i + 1;
      break;
    }
  }

  const timestamp = new Date();
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 3, 1, 3).setValues([[data.status, data.comment || '', timestamp]]);
  } else {
    sheet.appendRow([data.eventId, data.memberId, data.status, data.comment || '', timestamp]);
  }
  return { success: true };
}

/**
 * 初期セットアップ
 */
function setup() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [
    { name: 'Periods', headers: ['Id', 'Name', 'StartDate', 'EndDate'] },
    { name: 'Members', headers: ['Id', 'Name', 'Affiliation', 'JoinMonth', 'LeaveMonth'] },
    { name: 'Events', headers: ['Id', 'Date', 'Time', 'Location', 'Title', 'Note'] },
    { name: 'Attendance', headers: ['EventID', 'MemberID', 'Status', 'Comment', 'Timestamp'] }
  ];
  
  sheets.forEach(s => {
    let sheet = doc.getSheetByName(s.name);
    if (!sheet) {
      sheet = doc.insertSheet(s.name);
      sheet.appendRow(s.headers);
    }
  });
  return { success: true };
}

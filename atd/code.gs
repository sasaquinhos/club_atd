function doGet(e) {
  const action = e.parameter.action;
  if (action === 'get_event_names') {
    return handleGetEventNames();
  } else if (action === 'get_album_images') {
    return handleGetAlbumImages(e.parameter.eventName);
  } else if (action === 'getAlbumComments') {
    return handleGetAlbumComments(e.parameter.photoId);
  } else if (action === 'get_album_init_data') {
    return handleGetAlbumInitData();
  }

  // デフォルトルート（アクションがない場合）
  return ContentService.createTextOutput("Soccer Club API is running.");
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
      case 'upload_album_image':
        result = handleUploadAlbumImage(data);
        break;
      case 'saveAlbumComment':
        result = handleSaveAlbumComment(doc, data);
        break;
      case 'update_album_comment':
        result = handleUpdateAlbumComment(doc, data);
        break;
      case 'delete_album_comment':
        result = handleDeleteAlbumComment(doc, data);
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
  const cache = CacheService.getScriptCache();
  const cached = cache.get('initial_data');
  if (cached) return JSON.parse(cached);

  const data = {
    periods: getSheetData(doc, 'Periods'),
    members: getSheetData(doc, 'Members'),
    events: getSheetData(doc, 'Events'),
    attendance: getAttendanceData(doc)
  };
  
  cache.put('initial_data', JSON.stringify(data), 600); // 10分
  return data;
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
      const hLower = h.toLowerCase();
      if (val instanceof Date) {
        if (hLower.endsWith('time')) {
          val = Utilities.formatDate(val, "Asia/Tokyo", "HH:mm");
        } else if (hLower.endsWith('month')) {
          val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM");
        } else if (hLower === 'timestamp') {
          val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
        } else {
          val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd");
        }
      } else if (val !== null && val !== undefined) {
        // Fallback for strings
        if (hLower.endsWith('time') && typeof val === 'string' && val.match(/^\d{2}:\d{2}:\d{2}/)) {
           val = val.substring(0, 5);
        } else if (hLower.endsWith('month') && typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
           val = val.substring(0, 7);
        }
      } else if (hLower === 'canceled') {
        val = (val === true || String(val).toUpperCase() === 'TRUE');
      }
      obj[hLower] = val;
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
  // キャッシュクリア
  CacheService.getScriptCache().remove('initial_data');
  
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
  // キャッシュクリア
  CacheService.getScriptCache().remove('initial_data');

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
  const headers = ['Id', 'Date', 'Time', 'Location', 'Title', 'Note', 'DeadlineDate', 'DeadlineTime', 'Canceled'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    ensureHeaders(sheet, headers);
  }
  sheet.appendRow([data.id, data.date, data.time, data.location, data.title, data.note || '', data.deadlineDate || '', data.deadlineTime || '', data.canceled || false]);
  return { success: true };
}

/**
 * ヘッダーを確実に設定する（既存を上書きして構造を強制する）
 */
function ensureHeaders(sheet, expectedHeaders) {
  sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
}

function handleUpdateEvent(doc, data) {
  // キャッシュクリア
  const cache = CacheService.getScriptCache();
  cache.remove('initial_data');
  cache.remove('event_list');

  const sheet = doc.getSheetByName('Events');
  if (!sheet) return { success: false };
  const headers = ['Id', 'Date', 'Time', 'Location', 'Title', 'Note', 'DeadlineDate', 'DeadlineTime', 'Canceled'];
  ensureHeaders(sheet, headers);
  
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 2, 1, 8).setValues([[data.date, data.time, data.location, data.title, data.note || '', data.deadlineDate || '', data.deadlineTime || '', !!data.canceled]]);
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
  // キャッシュクリア
  CacheService.getScriptCache().remove('initial_data');

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
 * アルバム関連
 */
function handleGetAlbumInitData() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const cache = CacheService.getScriptCache();
  
  // メンバーデータとイベント一覧を統合して返す
  let members = [];
  const cachedInitial = cache.get('initial_data');
  if (cachedInitial) {
    members = JSON.parse(cachedInitial).members;
  } else {
    members = getSheetData(doc, 'Members');
  }

  const events = getEventList(doc);

  return createJsonResponse({
    result: 'success',
    members: members,
    events: events
  });
}

function getEventList(doc) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('event_list');
  if (cached) return JSON.parse(cached);

  const sheet = doc.getSheetByName('Events');
  if (!sheet) return [];
  
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  
  const events = [];
  rows.slice(1).forEach(row => {
    const date = row[1];
    const time = row[2];
    const name = row[4];
    const canceled = row[8];
    if (name) {
        let dateStr = "";
        let timeStr = "";
        
        if (date instanceof Date) {
            dateStr = Utilities.formatDate(date, "Asia/Tokyo", "yyyy-MM-dd");
        } else {
            dateStr = String(date).substring(0, 10);
        }
        
        if (time instanceof Date) {
            timeStr = Utilities.formatDate(time, "Asia/Tokyo", "HH:mm");
        } else if (time) {
            timeStr = String(time).substring(0, 5);
        }
        
        events.push({ 
          name: name, 
          date: dateStr,
          time: timeStr,
          canceled: !!canceled
        });
    }
  });

  events.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.time || "").localeCompare(a.time || "");
  });

  cache.put('event_list', JSON.stringify(events), 600); // 10分キャッシュ
  return events;
}

function handleGetEventNames() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const events = getEventList(doc);
  return createJsonResponse({ events: events });
}

function handleGetAlbumImages(eventName) {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = doc.getSheetByName('Album');
  if (!sheet || !eventName) return createJsonResponse({ images: [] });
  
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return createJsonResponse({ images: [] });
  
  const images = rows.slice(1)
    .filter(row => row[0] === eventName)
    .map(row => ({
      url: row[1],
      fileName: row[2],
      timestamp: row[3]
    }));
    
  return createJsonResponse({ images: images });
}

/**
 * 写真ごとのコメント取得
 */
function handleGetAlbumComments(photoId) {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = doc.getSheetByName('AlbumComments');
  if (!sheet || !photoId) return createJsonResponse({ comments: [] });
  
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return createJsonResponse({ comments: [] });
  
  const headers = rows[0].map(h => String(h).toLowerCase().trim());
  const photoIdIdx = headers.indexOf('photoid');
  
  if (photoIdIdx === -1) {
    console.error('photoid column not found in AlbumComments');
    return createJsonResponse({ comments: [], error: 'photoid column not found' });
  }
  
  const comments = rows.slice(1)
    .filter(row => String(row[photoIdIdx]) === String(photoId))
    .map(row => {
      let obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
        }
        obj[h] = val;
      });
      return obj;
    });
    
  return createJsonResponse({ comments: comments });
}

/**
 * 写真ごとのコメント保存
 */
function handleSaveAlbumComment(doc, data) {
  let sheet = doc.getSheetByName('AlbumComments') || doc.insertSheet('AlbumComments');
  const headers = ['commentId', 'photoId', 'userName', 'postUserId', 'commentText', 'timestamp'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  
  // IDの自動採番
  let lastId = 0;
  const rows = sheet.getDataRange().getValues();
  if (rows.length > 1) {
    lastId = Math.max(...rows.slice(1).map(row => Number(row[0]) || 0));
  }
  const newId = lastId + 1;

  const timestamp = new Date();
  sheet.appendRow([
    newId,
    data.photoId,
    data.userName,
    data.postUserId,
    data.commentText,
    timestamp
  ]);
  
  return { success: true, commentId: newId };
}

/**
 * 写真ごとのコメント更新
 */
function handleUpdateAlbumComment(doc, data) {
  const sheet = doc.getSheetByName('AlbumComments');
  if (!sheet) return { success: false, error: 'Sheet not found' };

  // 本人確認: 投稿時のIDと現在のユーザーIDが一致するかチェック
  if (String(data.postUserId) !== String(data.currentUserId)) {
    return { success: false, error: 'Permission denied' };
  }

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.commentId)) {
      // 5列目 (E列) が commentText
      sheet.getRange(i + 1, 5).setValue(data.newContent);
      return { success: true };
    }
  }
  return { success: false, error: 'Comment not found' };
}

/**
 * 写真ごとのコメント削除
 */
function handleDeleteAlbumComment(doc, data) {
  const sheet = doc.getSheetByName('AlbumComments');
  if (!sheet) return { success: false, error: 'Sheet not found' };

  // 本人確認
  if (String(data.postUserId) !== String(data.currentUserId)) {
    return { success: false, error: 'Permission denied' };
  }

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.commentId)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Comment not found' };
}

function handleUploadAlbumImage(data) {
  const rootFolderName = "projectC_album";
  let rootFolder;
  const folders = DriveApp.getFoldersByName(rootFolderName);
  
  if (folders.hasNext()) {
    rootFolder = folders.next();
  } else {
    rootFolder = DriveApp.createFolder(rootFolderName);
  }
  
  let eventFolder;
  const eventFolders = rootFolder.getFoldersByName(data.eventName);
  if (eventFolders.hasNext()) {
    eventFolder = eventFolders.next();
  } else {
    eventFolder = rootFolder.createFolder(data.eventName);
  }
  
  const contentType = data.fileData.split(',')[0].split(':')[1].split(';')[0];
  const bytes = Utilities.base64Decode(data.fileData.split(',')[1]);
  const blob = Utilities.newBlob(bytes, contentType, data.fileName);
  
  const file = eventFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  const imageUrl = `https://drive.google.com/thumbnail?sz=w1000&id=${file.getId()}`;
  
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = doc.getSheetByName('Album');
  if (!sheet) {
    sheet = doc.insertSheet('Album');
    sheet.appendRow(['EventName', 'ImageUrl', 'FileName', 'Timestamp']);
  }
  
  sheet.appendRow([data.eventName, imageUrl, data.fileName, new Date()]);
  
  return { success: true, imageUrl: imageUrl };
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 初期セットアップ
 */
function setup() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = [
    { name: 'Periods', headers: ['Id', 'Name', 'StartDate', 'EndDate'] },
    { name: 'Members', headers: ['Id', 'Name', 'Affiliation', 'JoinMonth', 'LeaveMonth'] },
    { name: 'Events', headers: ['Id', 'Date', 'Time', 'Location', 'Title', 'Note', 'DeadlineDate', 'DeadlineTime', 'Canceled'] },
    { name: 'Attendance', headers: ['EventID', 'MemberID', 'Status', 'Comment', 'Timestamp'] },
    { name: 'Album', headers: ['EventName', 'ImageUrl', 'FileName', 'Timestamp'] },
    { name: 'AlbumComments', headers: ['commentId', 'photoId', 'userName', 'postUserId', 'commentText', 'timestamp'] }
  ];
  
  sheets.forEach(s => {
    let sheet = doc.getSheetByName(s.name);
    if (!sheet) {
      sheet = doc.insertSheet(s.name);
      sheet.appendRow(s.headers);
    } else {
      // 既存シートでもヘッダーが不足していれば追加
      ensureHeaders(sheet, s.headers);
    }
  });
  return { success: true };
}

/**
 * 権限認証用
 * この関数をGASエディタで実行して、Google Driveへのアクセス権（フォルダ作成など）を承認してください。
 */
function checkDrivePermission() {
  try {
    // フォルダ作成の権限を強制的に要求するためのダミー処理
    const folder = DriveApp.createFolder("GAS_Auth_Check_Temp");
    console.log("Drive full permission checked. Created folder: " + folder.getName());
  } catch (e) {
    console.error("Error checking permission: " + e.toString());
  }
}

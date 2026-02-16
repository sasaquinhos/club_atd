// GAS Web App URL (デプロイ後に取得したURLをここに記載してください)
const GAS_URL = 'YOUR_GAS_WEB_APP_URL_HERE';

document.addEventListener('DOMContentLoaded', () => {
    loadEventNames();

    document.getElementById('upload-btn').addEventListener('click', handleUpload);
    document.getElementById('view-event-select').addEventListener('change', (e) => {
        if (e.target.value) {
            loadImages(e.target.value);
        } else {
            document.getElementById('photo-grid').innerHTML = '';
        }
    });
});

function switchAlbumTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    if (tab === 'view') {
        document.getElementById('album-view').classList.add('active');
        document.getElementById('tab-view-btn').classList.add('active');
    } else {
        document.getElementById('album-upload').classList.add('active');
        document.getElementById('tab-upload-btn').classList.add('active');
    }
}

async function loadEventNames() {
    try {
        const response = await fetch(`${GAS_URL}?action=get_event_names`);
        const data = await response.json();

        const viewSelect = document.getElementById('view-event-select');
        const uploadSelect = document.getElementById('upload-event-select');

        let options = '<option value="">-- イベントを選択 --</option>';
        data.eventNames.forEach(name => {
            options += `<option value="${name}">${name}</option>`;
        });

        viewSelect.innerHTML = options;
        uploadSelect.innerHTML = options;
    } catch (error) {
        console.error('Error fetching event names:', error);
        alert('イベント一覧の取得に失敗しました。GASのURLが正しいか確認してください。');
    }
}

async function handleUpload() {
    const eventName = document.getElementById('upload-event-select').value;
    const fileInput = document.getElementById('photo-input');
    const files = fileInput.files;

    if (!eventName || files.length === 0) {
        alert('イベントと写真を選択してください。');
        return;
    }

    showLoading(true);
    const statusDiv = document.getElementById('upload-status');
    statusDiv.innerText = `0 / ${files.length} 枚アップロード中...`;

    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
        try {
            const file = files[i];
            const base64Data = await readFileAsBase64(file);

            const response = await fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload_album_image',
                    eventName: eventName,
                    fileName: file.name,
                    fileData: base64Data
                })
            });

            const result = await response.json();
            if (result.result === 'success') {
                successCount++;
            }
            statusDiv.innerText = `${i + 1} / ${files.length} 枚アップロード中...`;
        } catch (error) {
            console.error('Upload error:', error);
        }
    }

    showLoading(false);
    alert(`${successCount} 枚の写真をアップロードしました。`);
    statusDiv.innerText = '';
    fileInput.value = '';

    // 閲覧タブのリロード（同じイベントを選択していた場合）
    if (document.getElementById('view-event-select').value === eventName) {
        loadImages(eventName);
    }
}

async function loadImages(eventName) {
    const grid = document.getElementById('photo-grid');
    grid.innerHTML = '<p style="text-align:center; padding:2rem;">読み込み中...</p>';

    try {
        const response = await fetch(`${GAS_URL}?action=get_album_images&eventName=${encodeURIComponent(eventName)}`);
        const data = await response.json();

        if (data.images.length === 0) {
            grid.innerHTML = '<p style="text-align:center; padding:2rem; color:#64748b;">まだ写真がありません。</p>';
            return;
        }

        grid.innerHTML = '';
        data.images.forEach(img => {
            const item = document.createElement('div');
            item.className = 'photo-item';
            item.innerHTML = `
                <img src="${img.url}" alt="${img.fileName}" onclick="openPhotoModal('${img.url}')">
            `;
            grid.appendChild(item);
        });
    } catch (error) {
        console.error('Error fetching images:', error);
        grid.innerHTML = '<p style="text-align:center; padding:2rem; color:red;">写真の取得に失敗しました。</p>';
    }
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function openPhotoModal(url) {
    const modal = document.getElementById('photo-modal');
    const modalImg = document.getElementById('modal-img');
    modalImg.src = url;
    modal.classList.add('active');
}

function closePhotoModal() {
    document.getElementById('photo-modal').classList.remove('active');
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

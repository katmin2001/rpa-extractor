# RPA / RPG Maker Extractor (bản web tĩnh)

Giải nén Ren'Py `.rpa` và giải mã RPG Maker MV/MZ (`.rpgmvp/.rpgmvo/.rpgmvm`)
**hoàn toàn trong trình duyệt** — file không được upload đi đâu, xử lý ngay tại máy.

Gồm 2 file: `index.html` + `rpacore.js`. Không cần server, không cần cài đặt.

## Chạy thử ở máy (tùy chọn)
Vì dùng ES module, phải mở qua HTTP (không mở trực tiếp `file://`):
```bash
cd web
python -m http.server 8777
```
Rồi vào http://127.0.0.1:8777/

## Deploy lên GitHub Pages

1. Tạo repo mới trên GitHub (ví dụ `rpa-extractor`).
2. Đưa **`index.html`** và **`rpacore.js`** vào **thư mục gốc** của repo:
   ```bash
   git init
   git add index.html rpacore.js
   git commit -m "RPA / RPG Maker web extractor"
   git branch -M main
   git remote add origin https://github.com/<user>/rpa-extractor.git
   git push -u origin main
   ```
3. Trên GitHub: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main** / **/ (root)** → **Save**
4. Đợi ~1 phút, trang xuất hiện tại:
   `https://<user>.github.io/rpa-extractor/`

## Ghi chú
- Kéo-thả cả thư mục cần Chrome/Edge (Firefox/Safari chỉ thả được nhiều file lẻ).
- ZIP dùng phương thức *store* (không nén — asset game vốn đã nén); giới hạn
  chuẩn 4GB/ file. Game rất lớn nên tải theo nhóm.
- `.rpgmvp` tự khôi phục key từ chữ ký PNG; audio-only không kèm `System.json`
  sẽ hỏi nhập key thủ công.
- RPA-1.0 cần file `.rpi` đi kèm (thả cả hai).

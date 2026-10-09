# TIẾP TỤC DỰ ÁN — AV01 / missav
Cập nhật: 2026-10-09. Bàn giao tiến độ thực tế, không suy diễn kết quả chưa thử.

## Nguồn
- Repository: chuongnguyen89dn-ui/missav, branch main.
- Catalog: data/av01-catalog.json. Tại thời điểm đọc GitHub có 1.678 phim (không mặc định coi con số 2.120 trước đây là hiện tại).
- Script: scripts/av01_avmates_cdn_scan.py, commit sửa regex 2705fe4391c6a9f058c0957c89b6fd91158972e0.
- Kết quả quét chỉ ở máy Windows của người dùng, CHƯA được đẩy lên GitHub: data/av01-avmates-cdn-images.json và av01_avmates_cdn/checkpoint.json.

## Quy tắc ảnh
- Ảnh dọc `ps.webp` là poster chính.
- Ảnh ngang `pl_poster_800w_q70.webp` và các ảnh `jp-N.webp` (nếu được xác minh) đều là snapshots.
- Chỉ lưu URL có phản hồi nội dung ảnh thật; không coi URL phỏng đoán là ảnh tồn tại.
- Số snapshots là số URL đã xác minh trong phạm vi dò, KHÔNG khẳng định là toàn bộ gallery.
- Không sửa catalog, manifest, resolver, HLS hoặc luồng phát đang hoạt động khi chưa xác nhận kết quả.
- Bộ quét CDN độc lập với Playwright/WordPress; trình duyệt Playwright từng mắc trang xác minh chống bot.

## Log thực tế người dùng đã chạy: 20 phim
```
OK YUJ-074 poster=True snapshots=11
OK NPJS-284 poster=True snapshots=11
OK NPJS-278 poster=True snapshots=12
OK CAWB-040 poster=True snapshots=18
OK ADN-793 poster=True snapshots=11
OK NPJB-131 poster=True snapshots=11
OK JBD-313 poster=True snapshots=11
OK NPJS-281 poster=True snapshots=11
OK ADN-811 poster=True snapshots=11
OK MIDA-812 poster=True snapshots=11
OK ADN-805 poster=True snapshots=11
OK WAAA-691 poster=True snapshots=15
OK ATID-700 poster=True snapshots=11
OK MIRD-287 poster=True snapshots=10
OK IPZZ-945 poster=True snapshots=16
SKIPPED_FC2_AMATEUR FC2-PPV-4987537 poster=False snapshots=0
OK ATID-706 poster=True snapshots=11
OK MNGS-068 poster=True snapshots=13
OK WAAA-693 poster=True snapshots=13
OK MIDA-797 poster=True snapshots=13
DONE verified=19 pending=0 skipped=1
```
- ID 221435: `code` rỗng; tiêu đề chứa FC2-PPV-4987537. Không quét AVMates; giữ nguyên dữ liệu ảnh cũ. Tránh nhận nhầm `AV-01` từ AV01.tv.
- ID 221340: `code=LADA-10` nhưng title có `ATID-706-lada`; dùng mã gốc ATID-706 để dò ảnh; kết quả poster và 11 snapshots.
- 19 phim OK, 1 FC2 bỏ qua, 0 pending. Chưa đưa kết quả ảnh lên addon.

## Mã đặc biệt: số liệu THỰC TẾ từ catalog GitHub
Phân loại sơ bộ trên 1.678 records (không khẳng định nhóm nào khác FC2 đều là phim nghiệp dư):
- 83 phim có `FC2-PPV` trong code/title/description.
- 3 phim khớp biểu thức mã có tiền tố số.
- 3 phim khớp biểu thức 6 chữ số-ngăn cách-3 chữ số (thực tế là mã CARIB có tiền tố).
- 1 phim HEYZO.
- Các số liệu nhóm dựa trên regex và ưu tiên phân nhóm, chưa là kiểm kê đầy đủ các dạng mã.

### Tên NGUYÊN VĂN và ID phim có thật trên AV01 (không dùng mã ví dụ tự đặt)
- 221435: `FC2-PPV-4987537•AV01.tv•Uncensored: Fair-Skinned Slender Inn Maid. A Pure Beauty Who Seduces Guests. [Overseas Edition] With Bonus`
- 220078: `FC2-PPV-4979807•AV01.tv•The Samen Grand Slam #1: Airline Employee Mio [Real/Full Uncut 29-Shot Burst]`
- 220284: `FC2-PPV-4981174•AV01.tv•Surrender Is the Ultimate Defense. A Bad Move Born of Immaturity.`
- 215209: `229SCUTE-1574•AV01.tv•Sui (25): Ultra-Sensitive Beauty's Nipple-Orgasm and Trembling Paralysis Sex`
- 217619: `AV01.tv | High-quality free AV video streaming` (title không có mã rõ; code `148CMA-20-M-KAWAII`; CHƯA xác minh mã gốc).
- 214153: `CAWB-026-lada•AV01.tv•[LADA Decensored] The Quiet Girl Awakens Through Extreme Sex: Meru Aragaki's Hardcore Creampie Awakening` (code `LADA-148CMA-20-KAWAII`).
- 212443: `CARIB-051326-001•AV01.tv•Lewd Samba Carnival with Double Senoritas: Nana Ueyama & Mina Sakura`
- 212442: `CARIB-051126-001•AV01.tv•Dynamite: Hina Sakurai`
- 212433: `CARIB-041526-001•AV01.tv•I Made the OL Handling My Complaint Apologize With Her Body! Vol.10 Ayu Kojima`
- 212478: `HEYZO-3825•AV01.tv•Slowly Torturing Her Super Erotic Body! ~Beauty Collection Vol.116~ Nako Nagase`
- Các mã ví dụ `200GANA-3125`, `259LUXU-1650`, `HEYZO-2998`, `061722-001` từng được nêu KHÔNG được xác nhận có trong catalog. Không dùng để xác minh.

## Quy tắc lọc đã yêu cầu
- FC2-PPV là nhóm nghiệp dư: bỏ qua quét poster CDN; người dùng trước đó còn yêu cầu loại khỏi catalog về sau. KHÔNG tự ý xóa phim đang live khi chưa có lệnh cụ thể ở bước hiện tại.
- Các nhóm GANA, HEYZO, CAWB và nhóm tương tự: cần xác minh trước khi lọc để tránh xóa nhầm. Không đánh đồng tất cả mã lạ với nghiệp dư.
- Trong phiên này người dùng yêu cầu đưa TÊN ĐẦY ĐỦ phim thật từ AV01 để tự xác thực, không chỉ ví dụ mã.

## Chạy tiếp trên Windows
```bat
cd C:\Users\Trinh\missav
git pull origin main
python -m py_compile scripts\av01_avmates_cdn_scan.py
python scripts\av01_avmates_cdn_scan.py --limit 20
```
Đã hoàn tất 20 phim theo log trên. Để chạy toàn bộ (chỉ khi xác nhận lọc và phạm vi), dùng `--limit 0`; checkpoint giữ phim đã thành công. Chưa xác minh độ bao phủ tất cả ảnh và chưa upload JSON kết quả lên GitHub.

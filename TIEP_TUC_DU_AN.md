# TIẾP TỤC DỰ ÁN — AV01 Hottest Scanner

## Bản scanner chuẩn — ƯU TIÊN GIỮ LẠI

**Trạng thái: BẢN THÀNH CÔNG NHẤT HIỆN TẠI.**

- Script chính: `scripts/av01_hottest_filtered_proven.py`
- Mốc code resolver quan trọng: commit `c909ebd14e3729474389e789677271bf12c86627` — `fix(av01): use proven geo cdn-access token flow`
- Nguồn quét: `https://www.av01.media/en/videos/hottest`
- Chế độ: quét toàn bộ Hottest, checkpoint/resume, pending retry, watchdog.
- Kết quả thực tế đã xác nhận: catalog đã tăng từ 446 lên ít nhất 700 phim verified trong phiên chạy này.
- **Không thay thế/viết lại scanner này từ đầu khi sửa lỗi. Chỉ sửa tối thiểu, giữ pipeline đã chứng minh hoạt động.**

## Vì sao bản này thành công

Điểm quyết định là bỏ phụ thuộc vào thao tác click player để chờ token. Scanner lấy token trực tiếp theo flow đã chứng minh:

1. GET `https://files.iw01.xyz/edge/geo.js?json`.
2. Lấy `token_v2`, `expires`, `ip`.
3. GET `https://customers.iw01.xyz/api/v1/videos/<VIDEO_ID>/cdn-access` với ba tham số trên.
4. Lấy `access_token`.
5. Dùng manifest 1080p:
   `https://www.av01.media/api/v1/videos/<VIDEO_ID>/manifest/index90-sv3-v1-a1.m3u8`
6. Rewrite/sign các URL CDN bằng `access_token`.
7. Chỉ ACCEPT khi probe các object đầu trả về `200/200`.

Dấu hiệu chạy đúng trong log:
- `DIRECT TOKEN OK`
- `RESOLVE QUEUED`
- `DONE <count> <code> OK 200/200`

## Quy tắc lọc hiện tại

- Năm chấp nhận: 2024, 2025, 2026.
- Các tag ngực lớn chỉ là **ưu tiên/xếp hạng**, KHÔNG bắt buộc.
- Hard block theo official tags: Anal; Toy/Sex Toys/Dildo; Cross Dressing; Lesbian/Gay; Shemale/Transsexual/Transgender; Mature/Mother/MILF.
- Không tính phim trùng ID.
- Không ACCEPT chỉ vì nhãn 1080p; phải probe nguồn phát thật.
- Metadata/tag chưa lấy được hoặc lỗi mạng/token tạm thời phải đưa vào pending, không FAIL vĩnh viễn.
- Poster/metadata cleanup là pass sau, không làm chậm pass quét/phát.

## Checkpoint và publish

- Checkpoint: `av01_hottest_full/checkpoint.json`.
- Catalog addon: `data/av01-catalog.json`.
- Scanner publish batch verified lên GitHub.
- Helper publish toàn bộ accepted checkpoint: `scripts/publish_av01_checkpoint_all.py`.
- Render không cần deploy trong lúc đang quét nếu chưa được yêu cầu.

## Cách viết/sửa script trên GitHub cho dự án này

Nguyên tắc bắt buộc:

1. **Đọc script đang chạy và lịch sử commit trước khi sửa.** Không suy diễn lại kiến trúc.
2. Tạo thay đổi nhỏ, đúng một mục tiêu. Không rewrite cả file khi pipeline đang chạy tốt.
3. Giữ nguyên các phần đã chứng minh: direct geo/cdn-access token, 1080 sv3 manifest, signed playlist, probe 200/200, checkpoint, pending retry, watchdog và publish.
4. Sau khi sửa Python phải kiểm tra cú pháp:
   `python -m py_compile scripts\\av01_hottest_filtered_proven.py`
5. Commit message phải mô tả đúng thay đổi, ví dụ:
   `fix(av01): use proven geo cdn-access token flow`
6. Trước khi restart scanner, phải xác định thay đổi có thật sự cần restart không. Không dừng một phiên quét đang chạy tốt chỉ để áp dụng thay đổi không cấp thiết.
7. Khi sửa lỗi, ưu tiên tham khảo code đã pass trong repo (đặc biệt `scripts/av01-vlc-proof.mjs`) thay vì tự tạo cơ chế token/player mới.
8. Không báo thành công nếu chưa có bằng chứng `DIRECT TOKEN OK` + `DONE ... OK 200/200` hoặc catalog commit tương ứng.

## Lệnh chạy chuẩn trên Windows CMD

```cmd
cd /d C:\Users\Trinh\Downloads\missav
git pull
python -m py_compile scripts\av01_hottest_filtered_proven.py
SCAN-AV01-FULL.cmd
```

Ctrl+Alt+F9 dùng để ẩn/hiện cửa sổ CMD; scanner vẫn tiếp tục chạy.

## Ghi chú cho lần tiếp tục sau

Khi tiếp tục dự án AV01, **bắt đầu từ file này và script `scripts/av01_hottest_filtered_proven.py`**. Không quay lại các scanner cũ đã thất bại. Bản direct-token hiện tại là baseline ưu tiên bảo toàn.

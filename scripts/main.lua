-- =============================================================================
-- Sample Automation Script using Human Touch Library
-- =============================================================================

-- Import human touch simulator
local ht = require("human_touch")

log("Khởi động kịch bản tự động hóa...")

-- Step 1: Open Safari
log("Bước 1: Khởi động Safari App")
appRun("com.apple.mobilesafari")
sleep(1.5) -- Wait 1.5 seconds for launch

-- Step 2: Perform some simulated taps on screen
log("Bước 2: Click vào thanh địa chỉ / vùng điều hướng")
-- Coordinates are logical points, e.g. for standard iPhone models (375x667)
ht.tap(187, 80) -- Tap near top center
sleep(1.0)

-- Step 3: Swipe down to scroll the page
log("Bước 3: Thực hiện vuốt màn hình để cuộn trang (Swipe down)")
ht.swipe(187, 500, 187, 200, 0.45) -- swipe from (187, 500) to (187, 200) in 0.45s
sleep(1.2)

-- Step 4: Long press on a mock element
log("Bước 4: Nhấn giữ liên kết (Long Press)")
ht.longPress(150, 300, 1.2) -- long press at (150, 300) for 1.2s
sleep(1.0)

log("Kịch bản chạy kết thúc thành công!")

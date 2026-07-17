-- =============================================================================
-- Human Touch Simulation Library for iOSControl
-- Author: Antigravity AI Pair Programmer
-- Version: 1.0.0
-- =============================================================================

local M = {}

-- Seed math random in case it hasn't been seeded
math.randomseed(os.time() + (timestamp and timestamp() or 0))

-- Helper to safely get random floats/ints (supporting iOSControl globals & vanilla Lua)
local function getRandFloat(min, max)
    if randomFloat then
        return randomFloat(min, max)
    else
        return min + math.random() * (max - min)
    end
end

local function getRandInt(min, max)
    if randomInt then
        return randomInt(min, max)
    else
        return math.random(min, max)
    end
end

-- Safely sleep in microseconds
local function uSleepSafe(usec)
    if usleep then
        usleep(usec)
    elseif sleep then
        sleep(usec / 1000000)
    else
        -- Fallback busy wait if no sleep functions are available
        local start = os.clock()
        local limit = usec / 1000000
        while os.clock() - start < limit do end
    end
end

-- =============================================================================
-- EASING FUNCTIONS (Simulating Physical Easing/Inertia)
-- =============================================================================

-- Quadratic Ease In Out: starts slow, accelerates in middle, slows down at end
local function easeInOutQuad(t)
    if t < 0.5 then
        return 2 * t * t
    else
        return 1 - ((-2 * t + 2) ^ 2) / 2
    end
end

local function easeInOutSine(t)
    return -(math.cos(math.pi * t) - 1) / 2
end

-- =============================================================================
-- BEZIER CURVES INTERPOLATION
-- =============================================================================

-- Calculates point at parameter t (0.0 to 1.0) along a Cubic Bezier Curve
-- defined by P0 (start), P1 (control 1), P2 (control 2), and P3 (end)
local function calculateBezierPoint(p0, p1, p2, p3, t)
    local t1 = 1 - t
    local t1_3 = t1 ^ 3
    local t1_2 = t1 ^ 2
    local t_2 = t ^ 2
    local t_3 = t ^ 3
    
    local x = t1_3 * p0.x + 3 * t1_2 * t * p1.x + 3 * t1 * t_2 * p2.x + t_3 * p3.x
    local y = t1_3 * p0.y + 3 * t1_2 * t * p1.y + 3 * t1 * t_2 * p2.y + t_3 * p3.y
    
    return x, y
end

-- =============================================================================
-- HUMAN TAP
-- =============================================================================
-- Simulates a human tap at (x, y) with coordinate jitter and hold delay.
-- @param x, y: Base target coordinates
-- @param jitter_radius: Max pixel offset from target (default 3.0 logical points)
-- @param finger: Finger ID to use (default 1)
function M.tap(x, y, jitter_radius, finger)
    jitter_radius = jitter_radius or 3.0
    finger = finger or 1
    
    -- 1. Apply spatial jitter (normal distribution approximation or simple uniform circle)
    local angle = getRandFloat(0, 2 * math.pi)
    local r = getRandFloat(0, jitter_radius)
    local final_x = x + r * math.cos(angle)
    local final_y = y + r * math.sin(angle)
    
    -- 2. Press down
    touchDown(finger, final_x, final_y)
    
    -- 3. Hold down for a micro-delay (typical human press is 70ms to 130ms)
    local hold_time = getRandInt(70000, 130000) -- microseconds
    uSleepSafe(hold_time)
    
    -- 4. Lift up
    touchUp(finger, final_x, final_y)
    
    -- 5. Return actual coordinates tapped for script tracking / debugging
    return final_x, final_y
end

-- =============================================================================
-- HUMAN SWIPE
-- =============================================================================
-- Simulates a natural human swipe from (x1, y1) to (x2, y2) along a Bezier path.
-- @param x1, y1: Start coordinates
-- @param x2, y2: End coordinates
-- @param duration: Approximate swipe time in seconds (default 0.25s - 0.4s random)
-- @param steps: Number of move coordinates to send (default 20 - 30 random)
-- @param finger: Finger ID to use (default 1)
function M.swipe(x1, y1, x2, y2, duration, steps, finger)
    finger = finger or 1
    duration = duration or getRandFloat(0.25, 0.45)
    steps = steps or getRandInt(18, 28)
    
    -- Apply spatial jitter to start and end points
    local angle_start = getRandFloat(0, 2 * math.pi)
    local r_start = getRandFloat(0, 3.0)
    local start_point = { x = x1 + r_start * math.cos(angle_start), y = y1 + r_start * math.sin(angle_start) }
    
    local angle_end = getRandFloat(0, 2 * math.pi)
    local r_end = getRandFloat(0, 4.0)
    local end_point = { x = x2 + r_end * math.cos(angle_end), y = y2 + r_end * math.sin(angle_end) }
    
    -- Calculate control points for Cubic Bezier to introduce a slight human curved movement
    local dx = end_point.x - start_point.x
    local dy = end_point.y - start_point.y
    local distance = math.sqrt(dx * dx + dy * dy)
    
    -- Normal vector perpendicular to the drag direction
    local nx, ny = 0, 0
    if distance > 0 then
        nx = -dy / distance
        ny = dx / distance
    end
    
    -- Human swipes are curved. Calculate a perpendicular offset (5% - 12% of total length)
    local deviation = distance * getRandFloat(0.04, 0.10)
    -- Randomize curl direction
    if getRandInt(1, 2) == 1 then
        deviation = -deviation
    end
    
    -- Control point 1: 1/3 of the way along the line, shifted by deviation
    local p1 = {
        x = start_point.x + (dx / 3) + (deviation * nx),
        y = start_point.y + (dy / 3) + (deviation * ny)
    }
    
    -- Control point 2: 2/3 of the way along the line, shifted by slightly different deviation
    local p2 = {
        x = start_point.x + (2 * dx / 3) + (deviation * 0.8 * nx),
        y = start_point.y + (2 * dy / 3) + (deviation * 0.8 * ny)
    }
    
    -- 1. Begin touch down at start point
    touchDown(finger, start_point.x, start_point.y)
    
    -- Wait a tiny moment after touch down to simulate finger registration (10-30ms)
    uSleepSafe(getRandInt(10000, 30000))
    
    -- 2. Loop through steps with Easing velocity
    local step_delay = (duration * 1000000) / steps
    
    for i = 1, steps do
        local progress = i / steps
        -- Apply quadratic easing for natural acceleration/deceleration
        local eased_t = easeInOutQuad(progress)
        
        -- Interpolate position along the Bezier curve
        local tx, ty = calculateBezierPoint(start_point, p1, p2, end_point, eased_t)
        
        -- Send touch move event
        touchMove(finger, tx, ty)
        
        -- Delay before next step, adding minor timing jitter (+/- 5%)
        local jittered_delay = step_delay * getRandFloat(0.95, 1.05)
        uSleepSafe(math.floor(jittered_delay))
    end
    
    -- Wait briefly at the end of swipe to simulate finger hovering/releasing (15-30ms)
    uSleepSafe(getRandInt(15000, 30000))
    
    -- 3. Touch Up at final end point
    touchUp(finger, end_point.x, end_point.y)
end

-- =============================================================================
-- HUMAN DOUBLE TAP
-- =============================================================================
function M.doubleTap(x, y, jitter_radius, finger)
    jitter_radius = jitter_radius or 3.0
    finger = finger or 1
    
    -- First Tap
    local tx1, ty1 = M.tap(x, y, jitter_radius, finger)
    
    -- Interval between taps (typical human interval is 150ms to 280ms)
    local interval = getRandInt(150000, 280000)
    uSleepSafe(interval)
    
    -- Second Tap (usually slightly offset from the first one even more)
    M.tap(tx1, ty1, jitter_radius * 0.5, finger)
end

-- =============================================================================
-- HUMAN LONG PRESS
-- =============================================================================
function M.longPress(x, y, duration, jitter_radius, finger)
    jitter_radius = jitter_radius or 3.0
    duration = duration or getRandFloat(1.0, 1.5)
    finger = finger or 1
    
    -- 1. Apply spatial jitter
    local angle = getRandFloat(0, 2 * math.pi)
    local r = getRandFloat(0, jitter_radius)
    local final_x = x + r * math.cos(angle)
    local final_y = y + r * math.sin(angle)
    
    -- 2. Press down
    touchDown(finger, final_x, final_y)
    
    -- 3. Maintain pressure for the specified duration (converted to microseconds)
    local elapsed = 0
    local target_usec = duration * 1000000
    
    -- Humans make micro-motions while holding down, simulating finger jitter
    while elapsed < target_usec do
        local micro_sleep = getRandInt(40000, 80000) -- 40ms - 80ms
        uSleepSafe(micro_sleep)
        elapsed = elapsed + micro_sleep
        
        -- Micro jitter move (less than 0.5 pixels)
        local mx = final_x + getRandFloat(-0.3, 0.3)
        local my = final_y + getRandFloat(-0.3, 0.3)
        touchMove(finger, mx, my)
    end
    
    -- 4. Lift up
    touchUp(finger, final_x, final_y)
end

return M

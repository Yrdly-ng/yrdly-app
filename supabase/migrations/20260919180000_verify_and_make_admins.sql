-- Migration: Verify and grant admin privileges for vickysalami04@gmail.com and ijomahopiah@gmail.com
UPDATE users
SET 
  is_admin = true,
  role = 'admin',
  verified_seller = true,
  phone_verified = true,
  phone_verified_at = COALESCE(phone_verified_at, NOW()),
  phone = CASE 
    WHEN lower(email) = 'vickysalami04@gmail.com' THEN '08160783600'
    WHEN lower(email) = 'ijomahopiah@gmail.com' THEN '09059976209'
    ELSE phone
  END,
  updated_at = NOW()
WHERE lower(email) IN ('vickysalami04@gmail.com', 'ijomahopiah@gmail.com');

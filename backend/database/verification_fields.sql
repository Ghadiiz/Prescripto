ALTER TABLE users 
ADD COLUMN is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN verification_token VARCHAR(255),
ADD COLUMN verification_token_expires DATETIME,
ADD COLUMN reset_password_token VARCHAR(255),
ADD COLUMN reset_password_token_expires DATETIME;

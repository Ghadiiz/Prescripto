-- Prescripto — database schema
-- Select your target database before running this file, e.g.:
--   CREATE DATABASE doctor_appointment;
--   USE doctor_appointment;
-- This file DROPS and recreates all tables, so only run it against the intended database.

-- Drop in dependency order (children first).
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS specialities;
DROP TABLE IF EXISTS users;


-- Patients (and admin accounts, distinguished by `role`).
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255),
  role VARCHAR(20) DEFAULT 'patient',
  phone VARCHAR(20),
  gender VARCHAR(10),
  dob DATE,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  image VARCHAR(255),
  is_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_token_expires DATETIME,
  reset_password_token VARCHAR(255),
  reset_password_token_expires DATETIME,
  UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Medical specialities (e.g. Dermatologist, Pediatrician).
CREATE TABLE specialities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  image VARCHAR(255),
  UNIQUE KEY name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Doctors.
CREATE TABLE doctors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255),
  image VARCHAR(500),
  speciality_id INT NOT NULL,
  degree VARCHAR(100) NOT NULL,
  experience VARCHAR(50),
  about TEXT,
  fees DECIMAL(10,2) NOT NULL,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  phone VARCHAR(20),
  available BOOLEAN DEFAULT TRUE,
  is_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_token_expires DATETIME,
  UNIQUE KEY email (email),
  KEY speciality_id (speciality_id),
  CONSTRAINT fk_doctors_speciality FOREIGN KEY (speciality_id)
    REFERENCES specialities (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Appointments.
CREATE TABLE appointments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  doctor_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  payment BOOLEAN DEFAULT FALSE,
  payment_method ENUM('cash') DEFAULT 'cash',
  amount DECIMAL(10,2) DEFAULT 0.00,
  cancellation_reason VARCHAR(500),
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_slot VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status = 'cancelled' THEN NULL ELSE CONCAT(doctor_id, '_', appointment_date, '_', appointment_time) END) VIRTUAL,
  KEY user_id (user_id),
  KEY idx_doctor_id (doctor_id),
  UNIQUE KEY unique_active_slot (active_slot),
  CONSTRAINT fk_appointments_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id)
    REFERENCES doctors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
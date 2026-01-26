USE doctor_appointment;


DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS specialities;
DROP TABLE IF EXISTS users;


CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  role VARCHAR(20) DEFAULT 'patient',
  phone VARCHAR(20),
  gender VARCHAR(10),
  dob DATE,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  image VARCHAR(255)
);


CREATE TABLE specialities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) UNIQUE NOT NULL,
  image VARCHAR(255)
);


CREATE TABLE doctors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  image VARCHAR(500),
  speciality_id INT NOT NULL,
  degree VARCHAR(100) NOT NULL,
  experience VARCHAR(50),
  about TEXT,
  fees DECIMAL(10,2) NOT NULL,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  available BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (speciality_id) REFERENCES specialities(id) ON DELETE RESTRICT
);


CREATE TABLE appointments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  doctor_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  UNIQUE KEY unique_slot (doctor_id, appointment_date, appointment_time)
);

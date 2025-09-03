-- Users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Roles table
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- User Roles (many-to-many via join table)
CREATE TABLE user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id)
) ENGINE=InnoDB;

-- Posts table
CREATE TABLE posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255),
  body TEXT,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Comments table
CREATE TABLE comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Orders table
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Order Items table
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Products table
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Status Codes table
CREATE TABLE status_codes (
  code VARCHAR(20) PRIMARY KEY,
  description VARCHAR(255)
) ENGINE=InnoDB;

-- Foreign Keys via ALTER
ALTER TABLE user_roles
  ADD CONSTRAINT fk_userroles_user FOREIGN KEY (user_id) REFERENCES users(id),
  ADD CONSTRAINT fk_userroles_role FOREIGN KEY (role_id) REFERENCES roles(id);

ALTER TABLE posts
  ADD CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE comments
  ADD CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id),
  ADD CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE order_items
  ADD CONSTRAINT fk_orderitems_order FOREIGN KEY (order_id) REFERENCES orders(id),
  ADD CONSTRAINT fk_orderitems_product FOREIGN KEY (product_id) REFERENCES products(id);

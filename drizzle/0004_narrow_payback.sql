ALTER TABLE `purchases` RENAME TO `sales`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`user_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`items` text NOT NULL,
	`subtotal` real NOT NULL,
	`total_gst` real NOT NULL,
	`total` real NOT NULL,
	`date` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "invoice_number", "user_id", "customer_id", "items", "subtotal", "total_gst", "total", "date", "created_at") SELECT "id", "invoice_number", "user_id", "customer_id", "items", "subtotal", "total_gst", "total", "date", "created_at" FROM `sales`;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
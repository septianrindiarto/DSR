CREATE TYPE "public"."activity_action" AS ENUM('create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'confirm');--> statement-breakpoint
CREATE TYPE "public"."car_category" AS ENUM('economy', 'standard', 'premium', 'luxury');--> statement-breakpoint
CREATE TYPE "public"."car_status" AS ENUM('available', 'rented', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."car_type" AS ENUM('MPV', 'SUV', 'Sedan', 'City Car', 'Sport');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'vip', 'inactive', 'pending');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('private', 'company');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."fin_category" AS ENUM('keuangan_inti', 'perpajakan', 'aset_armada', 'kepatuhan', 'operasional', 'payroll');--> statement-breakpoint
CREATE TYPE "public"."fin_status" AS ENUM('draft', 'submitted', 'final', 'archived');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('Bensin', 'Diesel', 'Pertamax', 'Electric');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('scheduled', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('routine', 'repair', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('Automatic', 'Manual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'superadmin', 'agent', 'demo', 'client', 'client_admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" "activity_action" NOT NULL,
	"entity" varchar(100) NOT NULL,
	"entity_id" varchar(100),
	"details" json,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cars" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"brand" varchar(100) NOT NULL,
	"type" "car_type" NOT NULL,
	"category" "car_category" DEFAULT 'standard',
	"year" integer,
	"license_plate" varchar(20),
	"color" varchar(50),
	"image" text NOT NULL,
	"gallery" json,
	"price" numeric(12, 2) NOT NULL,
	"max_price" numeric(12, 2),
	"capacity" integer NOT NULL,
	"transmission" "transmission" NOT NULL,
	"fuel" "fuel_type" DEFAULT 'Bensin',
	"description" text,
	"features" json,
	"status" "car_status" DEFAULT 'available',
	"available_count" integer DEFAULT 1,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"normal_balance" varchar(10) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chart_of_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"phone" varchar(50),
	"email" varchar(255),
	"notes" text,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"company_name" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"whatsapp" varchar(50),
	"customer_type" "customer_type" DEFAULT 'private',
	"job" varchar(255),
	"address" text,
	"status" "customer_status" DEFAULT 'active',
	"notes" text,
	"total_orders" integer DEFAULT 0,
	"last_order_date" timestamp,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "dashboard_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"widget_config" json NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "dashboard_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50) NOT NULL,
	"license_number" varchar(50),
	"license_expiry" timestamp,
	"license_doc_url" text,
	"id_card_url" text,
	"photo_url" text,
	"status" "driver_status" DEFAULT 'active',
	"address" text,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "financial_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" "fin_category" NOT NULL,
	"period" varchar(100),
	"status" "fin_status" DEFAULT 'draft',
	"file_url" text,
	"file_type" varchar(20),
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_date" timestamp NOT NULL,
	"month" integer,
	"description" varchar(500) NOT NULL,
	"category" varchar(100) NOT NULL,
	"debit" numeric(15, 2) DEFAULT '0',
	"credit" numeric(15, 2) DEFAULT '0',
	"reference" varchar(100),
	"batch_id" varchar(50),
	"journal_ref" varchar(20),
	"is_reversal" boolean DEFAULT false,
	"reversal_of" integer,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "locked_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer,
	"locked_by" text
);
--> statement-breakpoint
CREATE TABLE "maintenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"car_id" integer NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"description" text,
	"scheduled_date" timestamp NOT NULL,
	"completed_date" timestamp,
	"cost" numeric(12, 2),
	"notes" text,
	"status" "maintenance_status" DEFAULT 'scheduled',
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"car_id" integer,
	"customer_id" integer NOT NULL,
	"driver_id" integer,
	"pickup_date" timestamp NOT NULL,
	"return_date" timestamp NOT NULL,
	"pickup_location" text,
	"total_days" integer NOT NULL,
	"daily_rate" numeric(12, 2) NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"status" "order_status" DEFAULT 'pending',
	"notes" text,
	"package" varchar(50),
	"destination" varchar(255),
	"overnight_nights" integer DEFAULT 0,
	"overtime_hours" numeric(5, 2) DEFAULT '0',
	"bailout" numeric(12, 2) DEFAULT '0',
	"whatsapp_sent" boolean DEFAULT false,
	"approved_by" text,
	"approved_at" timestamp,
	"invoice_number" varchar(50),
	"invoice_letter_number" varchar(50),
	"invoice_sent_date" timestamp,
	"invoice_due_date" timestamp,
	"invoice_paid_date" timestamp,
	"invoice_payment_status" varchar(20),
	"source_origin" varchar(20) DEFAULT 'web',
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_name_unique" UNIQUE("name"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"order_id" integer,
	"rating" integer NOT NULL,
	"comment" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"file_path" text,
	"file_size" integer,
	"rows_read" integer DEFAULT 0,
	"customers_inserted" integer DEFAULT 0,
	"customers_updated" integer DEFAULT 0,
	"drivers_inserted" integer DEFAULT 0,
	"drivers_updated" integer DEFAULT 0,
	"cars_inserted" integer DEFAULT 0,
	"cars_updated" integer DEFAULT 0,
	"orders_inserted" integer DEFAULT 0,
	"orders_updated" integer DEFAULT 0,
	"errors" json,
	"duration_ms" integer,
	"triggered_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'admin',
	"organization_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_prefs" ADD CONSTRAINT "dashboard_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_periods" ADD CONSTRAINT "locked_periods_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
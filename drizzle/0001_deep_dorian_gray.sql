CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);

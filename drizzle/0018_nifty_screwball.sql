CREATE TABLE "company_logo" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"sha256" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_logo" ADD CONSTRAINT "company_logo_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_snapshot_kind_entity" ON "document_snapshots" USING btree ("kind","entity_id");
--> statement-breakpoint
ALTER TABLE company_logo ADD CONSTRAINT singleton_company_logo CHECK(id=1 AND mime='image/png' AND length(data)<=700000);
--> statement-breakpoint
CREATE FUNCTION immutable_document_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Issued document snapshots are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_document_snapshot_guard BEFORE UPDATE OR DELETE ON document_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_document_snapshot();

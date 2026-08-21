CREATE TABLE "aircraft" (
	"id" text PRIMARY KEY NOT NULL,
	"icao24" varchar(6) NOT NULL,
	"registration" text,
	"manufacturer" text,
	"model" text,
	"variant" text,
	"type_code" varchar(8),
	"operator" text,
	"category" text NOT NULL,
	"active_from" date,
	"active_until" date,
	"tracking_enabled" boolean DEFAULT false NOT NULL,
	"is_rotorcraft" boolean DEFAULT false NOT NULL,
	"cost_model_key" text,
	"verification_status" text DEFAULT 'needs_verification' NOT NULL,
	"data_status" text DEFAULT 'real' NOT NULL,
	"notes" text,
	"source_url" text,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airport" (
	"id" text PRIMARY KEY NOT NULL,
	"ident" text NOT NULL,
	"icao" varchar(4),
	"iata" varchar(3),
	"name" text NOT NULL,
	"city" text,
	"country" varchar(2),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"elevation_ft" integer,
	"type" text NOT NULL,
	"scheduled_service" boolean DEFAULT false NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE TABLE "cost_model" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"applies_to_aircraft_id" text,
	"applies_to_type_code" varchar(8),
	"valid_from" date NOT NULL,
	"valid_to" date,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"params" jsonb NOT NULL,
	"verification_status" text DEFAULT 'needs_verification' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "cost_model_change" (
	"id" text PRIMARY KEY NOT NULL,
	"cost_model_key" text NOT NULL,
	"from_version" integer,
	"to_version" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"valid_from" date NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text,
	"source_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "flight" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"aircraft_id" text NOT NULL,
	"departure_time" timestamp with time zone NOT NULL,
	"arrival_time" timestamp with time zone,
	"departure_time_estimated" boolean DEFAULT false NOT NULL,
	"arrival_time_estimated" boolean DEFAULT false NOT NULL,
	"departure_airport_id" text,
	"arrival_airport_id" text,
	"probable_departure_airport_id" text,
	"probable_arrival_airport_id" text,
	"route_id" text,
	"duration_seconds" integer,
	"distance_km" real,
	"distance_from_gaps_km" real,
	"great_circle_km" real,
	"max_altitude_ft" integer,
	"callsign" varchar(12),
	"data_coverage" real,
	"route_confidence" real,
	"departure_airport_confidence" real,
	"arrival_airport_confidence" real,
	"confidence" text,
	"position_count" integer DEFAULT 0 NOT NULL,
	"max_gap_seconds" integer,
	"median_interval_seconds" real,
	"positioning_likelihood" real,
	"data_source" text NOT NULL,
	"data_status" text DEFAULT 'real' NOT NULL,
	"detector_version" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_cost" (
	"flight_id" text PRIMARY KEY NOT NULL,
	"cost_model_id" text,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"estimated_cost_low" real,
	"estimated_cost_mid" real,
	"estimated_cost_high" real,
	"breakdown" jsonb NOT NULL,
	"cost_confidence" real,
	"engine_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_purpose" (
	"id" text PRIMARY KEY NOT NULL,
	"flight_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source_url" text,
	"source_publisher" text,
	"source_published_at" timestamp with time zone,
	"source_id" text,
	"confidence" real,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_track" (
	"flight_id" text PRIMARY KEY NOT NULL,
	"points" jsonb NOT NULL,
	"point_count" integer NOT NULL,
	"simplified_from" integer NOT NULL,
	"gaps" jsonb
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"aircraft_icao24" varchar(6) NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"positions_downloaded" integer DEFAULT 0 NOT NULL,
	"positions_stored" integer DEFAULT 0 NOT NULL,
	"flights_detected" integer DEFAULT 0 NOT NULL,
	"error" text,
	"params" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_adsb_position" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"aircraft_icao24" varchar(6) NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"altitude_baro" integer,
	"altitude_geom" integer,
	"ground_speed" real,
	"vertical_rate" integer,
	"track" real,
	"callsign" varchar(12),
	"on_ground" boolean,
	"position_age_seconds" real,
	"source" text NOT NULL,
	"data_status" text DEFAULT 'real' NOT NULL,
	"import_job_id" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_airport_id" text,
	"destination_airport_id" text,
	"city_pair_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "aircraft" ADD CONSTRAINT "aircraft_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "airport" ADD CONSTRAINT "airport_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_model" ADD CONSTRAINT "cost_model_applies_to_aircraft_id_aircraft_id_fk" FOREIGN KEY ("applies_to_aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_model_change" ADD CONSTRAINT "cost_model_change_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_aircraft_id_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_departure_airport_id_airport_id_fk" FOREIGN KEY ("departure_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_arrival_airport_id_airport_id_fk" FOREIGN KEY ("arrival_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_probable_departure_airport_id_airport_id_fk" FOREIGN KEY ("probable_departure_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_probable_arrival_airport_id_airport_id_fk" FOREIGN KEY ("probable_arrival_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight" ADD CONSTRAINT "flight_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_cost" ADD CONSTRAINT "flight_cost_flight_id_flight_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flight"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_cost" ADD CONSTRAINT "flight_cost_cost_model_id_cost_model_id_fk" FOREIGN KEY ("cost_model_id") REFERENCES "public"."cost_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_purpose" ADD CONSTRAINT "flight_purpose_flight_id_flight_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flight"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_purpose" ADD CONSTRAINT "flight_purpose_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_track" ADD CONSTRAINT "flight_track_flight_id_flight_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flight"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_adsb_position" ADD CONSTRAINT "raw_adsb_position_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_origin_airport_id_airport_id_fk" FOREIGN KEY ("origin_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_destination_airport_id_airport_id_fk" FOREIGN KEY ("destination_airport_id") REFERENCES "public"."airport"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aircraft_icao24_uq" ON "aircraft" USING btree ("icao24");--> statement-breakpoint
CREATE INDEX "aircraft_tracking_idx" ON "aircraft" USING btree ("tracking_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "airport_ident_uq" ON "airport" USING btree ("ident");--> statement-breakpoint
CREATE INDEX "airport_icao_idx" ON "airport" USING btree ("icao");--> statement-breakpoint
CREATE INDEX "airport_iata_idx" ON "airport" USING btree ("iata");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_model_key_version_uq" ON "cost_model" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "cost_model_validity_idx" ON "cost_model" USING btree ("key","valid_from");--> statement-breakpoint
CREATE INDEX "cost_model_change_key_idx" ON "cost_model_change" USING btree ("cost_model_key","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_public_id_uq" ON "flight" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_natural_uq" ON "flight" USING btree ("aircraft_id","departure_time");--> statement-breakpoint
CREATE INDEX "flight_aircraft_dep_idx" ON "flight" USING btree ("aircraft_id","departure_time");--> statement-breakpoint
CREATE INDEX "flight_published_idx" ON "flight" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "flight_dep_airport_idx" ON "flight" USING btree ("departure_airport_id");--> statement-breakpoint
CREATE INDEX "flight_arr_airport_idx" ON "flight" USING btree ("arrival_airport_id");--> statement-breakpoint
CREATE INDEX "flight_cost_model_idx" ON "flight_cost" USING btree ("cost_model_id");--> statement-breakpoint
CREATE INDEX "flight_purpose_flight_idx" ON "flight_purpose" USING btree ("flight_id");--> statement-breakpoint
CREATE INDEX "import_job_aircraft_idx" ON "import_job" USING btree ("aircraft_icao24","range_from");--> statement-breakpoint
CREATE INDEX "import_job_status_idx" ON "import_job" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_pos_dedup_uq" ON "raw_adsb_position" USING btree ("aircraft_icao24","ts","source");--> statement-breakpoint
CREATE INDEX "raw_pos_aircraft_ts_idx" ON "raw_adsb_position" USING btree ("aircraft_icao24","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "route_pair_uq" ON "route" USING btree ("origin_airport_id","destination_airport_id");--> statement-breakpoint
CREATE INDEX "route_city_pair_idx" ON "route" USING btree ("city_pair_key");--> statement-breakpoint
CREATE INDEX "source_type_idx" ON "source" USING btree ("type");
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParentalProfiles1790603385063 implements MigrationInterface {
  name = 'AddParentalProfiles1790603385063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "parental_profile" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "maxAge" integer NOT NULL, "allowUnrated" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9f738cf4c52369d6c9c714af41d" UNIQUE ("name"), CONSTRAINT "PK_7d88c3f3ebdfac725ad8bafcc9e" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "parentalProfileId" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD CONSTRAINT "FK_1aa6a51f8a9d0c106f602b53c71" FOREIGN KEY ("parentalProfileId") REFERENCES "parental_profile"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP CONSTRAINT "FK_1aa6a51f8a9d0c106f602b53c71"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "parentalProfileId"`
    );
    await queryRunner.query(`DROP TABLE "parental_profile"`);
  }
}

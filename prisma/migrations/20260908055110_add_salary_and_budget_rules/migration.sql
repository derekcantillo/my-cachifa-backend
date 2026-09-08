-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'SALARY';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "budget_period" TEXT;

-- CreateTable
CREATE TABLE "budget_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "target_percentage" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_rules_user_id_category_key" ON "budget_rules"("user_id", "category");

-- AddForeignKey
ALTER TABLE "budget_rules" ADD CONSTRAINT "budget_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

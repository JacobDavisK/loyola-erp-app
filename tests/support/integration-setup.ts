import "dotenv/config";

// Point every module (Prisma client included) at the disposable test database before it is imported.
const url = new URL(process.env.DATABASE_URL!);
url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "examcore_test"}`;
process.env.DATABASE_URL = url.toString();
process.env.STORAGE_DIR = "./storage-test";

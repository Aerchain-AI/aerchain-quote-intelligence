import { PrismaClient } from "@prisma/client";

// Single shared Prisma client — SQLite is a single file, no connection pool concerns.
export const prisma = new PrismaClient();

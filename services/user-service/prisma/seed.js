// prisma/seed.js
// Run with: npx prisma db seed

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create test rider
  const riderHash = await bcrypt.hash("password123", 12);
  const rider = await prisma.user.upsert({
    where: { email: "rider@test.com" },
    update: {},
    create: {
      name: "Test Rider",
      email: "rider@test.com",
      passwordHash: riderHash,
      role: "rider",
    },
  });

  // Create test driver
  const driverHash = await bcrypt.hash("password123", 12);
  const driver = await prisma.user.upsert({
    where: { email: "driver@test.com" },
    update: {},
    create: {
      name: "Test Driver",
      email: "driver@test.com",
      passwordHash: driverHash,
      role: "driver",
      driverProfile: {
        create: {
          vehicleNumber: "DL01AB1234",
          vehicleModel: "Maruti Swift",
          licenseNumber: "DL-1234567890",
          isVerified: true,
        },
      },
    },
  });

  console.log("Seeded:", { rider: rider.email, driver: driver.email });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

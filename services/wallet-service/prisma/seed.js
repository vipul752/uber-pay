// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Seeding wallet database...");

  // Create wallets for test users with starting balance
  const testUsers = [
    { userId: "00000000-0000-0000-0000-000000000001", balance: 2000 },
    { userId: "00000000-0000-0000-0000-000000000002", balance: 5000 },
  ];

  for (const u of testUsers) {
    const wallet = await prisma.wallet.upsert({
      where: { userId: u.userId },
      update: {},
      create: { userId: u.userId, balance: u.balance },
    });
    console.log(`Wallet for ${u.userId}: ₹${wallet.balance}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

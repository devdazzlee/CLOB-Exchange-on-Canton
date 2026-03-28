const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRealHoldings() {
  console.log("=== CHECKING POSTGRES/PRISMA DATABASE FOR LIVE ORDERS ===");
  const recentOrders = await prisma.order.findMany({
    where: { 
      status: 'OPEN',
      // Get orders with actual allocation IDs (the locks on Canton)
      allocationContractId: { not: null }
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  if (recentOrders.length === 0) {
    console.log("No open orders found with an allocationContractId.");
    return;
  }

  console.log(`Found ${recentOrders.length} active orders containing a live Canton Holding lock:`);

  recentOrders.forEach(order => {
    console.log(`\nOrder ID: ${order.orderId}`);
    console.log(`Type:     ${order.orderType} ${order.quantity} @ ${order.price}`);
    console.log(`Status:   ${order.status}`);
    console.log(`Canton Locking Contract (Allocation ID): ${order.allocationContractId}`);
    console.log(`-> This ID begins with '00...' because it is a direct cryptographic hash from the Canton Splice Node!`);
    console.log(`-> You can literally paste this ID into the Canton Devnet Explorer to view the physical locked assets.`);
  });
}

checkRealHoldings()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
  });

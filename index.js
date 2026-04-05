#!/usr/bin/env node
require('dotenv').config();

const TradingBot = require('./src/bot');

const COMMANDS = {
  start: 'Start the bot (live scanning + trading)',
  analyze: 'Run one-time analysis without placing trades',
  status: 'Show bot & risk status',
  help: 'Show this help message',
};

async function main() {
  const command = process.argv[2] || 'analyze';
  const bot = new TradingBot();

  try {
    switch (command) {
      case 'start':
        await bot.initialize();
        const interval = parseInt(process.argv[3]) || 60000;
        await bot.start(interval);

        // Graceful shutdown
        process.on('SIGINT', () => {
          console.log('\n[BOT] Shutting down...');
          bot.stop();
          process.exit(0);
        });
        process.on('SIGTERM', () => {
          bot.stop();
          process.exit(0);
        });
        break;

      case 'analyze':
        await bot.initialize();
        await bot.analyze();
        process.exit(0);
        break;

      case 'status':
        bot.printStats();
        break;

      case 'help':
        console.log('\nVIZO Tradathon Bot\n');
        console.log('Usage: node index.js <command> [options]\n');
        console.log('Commands:');
        for (const [cmd, desc] of Object.entries(COMMANDS)) {
          console.log(`  ${cmd.padEnd(12)} ${desc}`);
        }
        console.log('\nExamples:');
        console.log('  node index.js analyze          # One-time market analysis');
        console.log('  node index.js start             # Start bot (60s interval)');
        console.log('  node index.js start 30000       # Start bot (30s interval)');
        console.log('\nConfiguration: Edit .env file');
        console.log('  DRY_RUN=true     → Simulate trades (default)');
        console.log('  DRY_RUN=false    → Live trading');
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run "node index.js help" for usage');
        process.exit(1);
    }
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    if (err.message.includes('PRIVATE_KEY')) {
      console.log('\n💡 Setup: Copy .env.example → .env and add your private key');
    }
    process.exit(1);
  }
}

main();

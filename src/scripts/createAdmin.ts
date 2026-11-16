import readline from 'readline';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { prisma } from '../connection/db.js';
import { Role } from '@prisma/client';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
  console.log('====================================');
  console.log('       ADMIN CREATION SCRIPT        ');
  console.log('====================================\n');

  try {
    // Check command-line args or fallback to interactive input
    const args = process.argv.slice(2);
    let name = args[0] || process.env.ADMIN_NAME;
    let email = args[1] || process.env.ADMIN_EMAIL;
    let password = args[2] || process.env.ADMIN_PASSWORD;

    if (!name) {
      name = await question('Enter Admin Name: ');
    }
    if (!email) {
      email = await question('Enter Admin Email: ');
    }
    if (!password) {
      password = await question('Enter Admin Password: ');
    }

    name = name.trim();
    email = email.trim().toLowerCase();
    password = password.trim();

    if (!name || !email || !password) {
      console.error('\n❌ Error: Name, email, and password are all required.');
      process.exit(1);
    }

    if (password.length < 6) {
      console.error('\n❌ Error: Password must be at least 6 characters long.');
      process.exit(1);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUser) {
      console.log(`\n⚠️  User with email "${email}" already exists.`);
      const answer = await question('Do you want to update this user to ADMIN with the new password? (y/N): ');
      if (answer.trim().toLowerCase() !== 'y') {
        console.log('Operation cancelled.');
        return;
      }

      const updated = await prisma.user.update({
        where: { email },
        data: {
          name,
          password: hashedPassword,
          role: Role.ADMIN,
        },
      });

      console.log('\n✅ Admin updated successfully:');
      console.log(`- ID: ${updated.id}`);
      console.log(`- Name: ${updated.name}`);
      console.log(`- Email: ${updated.email}`);
      console.log(`- Role: ${updated.role}`);
    } else {
      const created = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: Role.ADMIN,
        },
      });

      console.log('\n✅ Admin created successfully:');
      console.log(`- ID: ${created.id}`);
      console.log(`- Name: ${created.name}`);
      console.log(`- Email: ${created.email}`);
      console.log(`- Role: ${created.role}`);
    }
  } catch (error) {
    console.error('\n❌ Failed to create admin:', error);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main();

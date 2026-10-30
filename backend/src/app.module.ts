import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SaudeController],
})
export class AppModule {}

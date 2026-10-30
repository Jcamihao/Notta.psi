import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('saude')
export class SaudeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async saude() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // sem detalhe do erro na resposta
      throw new ServiceUnavailableException({ status: 'indisponivel' });
    }
    return { status: 'ok' };
  }
}

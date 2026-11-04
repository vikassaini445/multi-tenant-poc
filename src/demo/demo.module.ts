import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemoController } from './demo.controller';

@Module({
  imports: [AuthModule],
  controllers: [DemoController],
})
export class DemoModule {}

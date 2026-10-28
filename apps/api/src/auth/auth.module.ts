import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService, authConfig } from './auth.service';
import { AuthController } from './auth.controller';

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => authConfig })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

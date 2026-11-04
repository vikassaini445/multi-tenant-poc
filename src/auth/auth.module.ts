import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { requireEnv } from '../config/env';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = requireEnv('JWT_SECRET');
        if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
        return {
          secret,
          // Pinning the algorithm rejects "alg: none" and algorithm-confusion tokens.
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: requireEnv('JWT_ISSUER'),
            audience: requireEnv('JWT_AUDIENCE'),
          },
          signOptions: {
            algorithm: 'HS256',
            issuer: requireEnv('JWT_ISSUER'),
            audience: requireEnv('JWT_AUDIENCE'),
            expiresIn: '1h',
          },
        };
      },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}

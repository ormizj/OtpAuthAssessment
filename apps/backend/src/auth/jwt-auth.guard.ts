import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { TokenType } from './auth.config';

const TOKEN_TYPE = Symbol('TOKEN_TYPE');

export interface TokenPayload {
  /** User id for `session` tokens, verified E.164 phone for `registration` tokens. */
  sub: string;
  typ: TokenType;
}

type AuthedRequest = Request & { auth?: TokenPayload };

/**
 * Requires `Authorization: Bearer <jwt>` with a valid signature, not expired, and of the given
 * type: a registration ticket is not a session, and a session cannot complete a registration.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expected = this.reflector.get<TokenType>(TOKEN_TYPE, context.getHandler());
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== expected || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.auth = payload;
    return true;
  }
}

/** Protects a route with a token of the given type. */
export const Auth = (type: TokenType) => applyDecorators(SetMetadata(TOKEN_TYPE, type), UseGuards(JwtAuthGuard));

/** The verified token's `sub` (see `TokenPayload`). */
export const TokenSubject = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthedRequest>().auth!.sub,
);

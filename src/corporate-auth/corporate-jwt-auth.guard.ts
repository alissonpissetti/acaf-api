import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class CorporateJwtAuthGuard extends AuthGuard('corporate-jwt') {}

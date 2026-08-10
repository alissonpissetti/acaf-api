import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PartnerJwtAuthGuard extends AuthGuard('partner-jwt') {}

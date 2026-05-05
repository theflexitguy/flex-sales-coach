export type UserRole = "rep" | "manager";

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly playbookRole?: string;
  readonly teamId: string;
  readonly avatarUrl: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly managerId: string;
  readonly includedReps: number;
  readonly includedRepPriceCents: number;
  readonly extraRepPriceCents: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

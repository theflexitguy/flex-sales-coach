export interface RepDailyStat {
  readonly id: string;
  readonly repId: string;
  readonly teamId: string;
  readonly statDate: string;
  readonly callsCount: number;
  readonly avgScore: number | null;
  readonly totalObjections: number;
  readonly handledWell: number;
  readonly recordingSeconds: number;
}

export interface Badge {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly earned: boolean;
}

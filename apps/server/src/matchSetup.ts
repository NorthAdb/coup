import type { SeatController } from "@coup/domain";

export type MatchSetupSeatInput = {
  seatId: string;
  controller: SeatController;
  displayName: string;
};

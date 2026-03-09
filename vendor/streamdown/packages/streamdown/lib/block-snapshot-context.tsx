import type { StreamdownCodeBlockSnapshot } from "@streamdown/core";
import { createContext, useContext } from "react";

export const BlockSnapshotContext = createContext<
  StreamdownCodeBlockSnapshot | undefined
>(undefined);

export const useBlockSnapshot = () => useContext(BlockSnapshotContext);

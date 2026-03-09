import React from "react";

type Props = Record<string, unknown> & { children?: React.ReactNode };

export const Linking = {
  openURL: async (_url: string) => undefined,
};

export const Image = ({ children, ...props }: Props) =>
  React.createElement("Image", props, children);

export const ScrollView = ({ children, ...props }: Props) =>
  React.createElement("ScrollView", props, children);

export const Text = ({ children, ...props }: Props) =>
  React.createElement("Text", props, children);

export const View = ({ children, ...props }: Props) =>
  React.createElement("View", props, children);

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T) => styles,
};

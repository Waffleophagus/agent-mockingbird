import React from "react";

const Animated = {
  Text: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement("Text", props, children),
};

const enteringBuilder = {
  duration: () => enteringBuilder,
  easing: () => enteringBuilder,
};

export const Easing = {
  linear: () => 0,
  quad: () => 0,
  in: (_v: unknown) => () => 0,
  out: (_v: unknown) => () => 0,
  inOut: (_v: unknown) => () => 0,
};

export const FadeIn = enteringBuilder;
export const SlideInUp = enteringBuilder;

export default Animated;

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import * as React from "react";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => {
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn("inline-flex h-10 items-center rounded-lg border border-border bg-muted p-1", className)}
        {...props}
      />
    );
  },
);
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Tab>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>
>(({ className, ...props }, ref) => {
  return (
    <TabsPrimitive.Tab
      ref={ref}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 data-[selected]:bg-card data-[selected]:text-card-foreground",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Panel>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>
>(({ className, ...props }, ref) => {
  return <TabsPrimitive.Panel ref={ref} className={cn("mt-4 outline-none", className)} {...props} />;
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger };

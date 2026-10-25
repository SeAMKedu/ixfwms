-- Cut stock: items cut by length (profiles) or as sheets keep each piece's size, so offcuts
-- stay pieces of their own. A lot of mode 'cut' lists its pieces; quantity is how many.
ALTER TABLE `parts` ADD `cut` text;
--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `pieces` text;

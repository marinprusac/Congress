-- chamber-fitness used to sync its Exhibit urls with its own chamber prefix
-- ("/fitness/workouts/1") instead of Chamber-relative ("/workouts/1") like
-- every other Chamber, so navigateToExhibit built "/fitness/fitness/...".
-- Fixed at the source; this rewrites the rows already cached.
UPDATE `exhibit_cache` SET `url` = substr(`url`, 9) WHERE `chamber` = 'fitness' AND `url` LIKE '/fitness/%';

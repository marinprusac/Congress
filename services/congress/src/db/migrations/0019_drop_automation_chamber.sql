-- The Automation Chamber was deleted; its stale registry row would otherwise
-- sit "offline" forever (the registry cannot retire a Chamber, see 0017).
DELETE FROM chambers WHERE name = 'automation';

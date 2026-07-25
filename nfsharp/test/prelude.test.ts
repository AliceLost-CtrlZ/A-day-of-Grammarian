import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertError, evaluate, failure, lines, typeOf } from "./helpers.ts";

/** Each entry is `expression`, `expected value`, `expected type`. */
const cases: [string, string, string][] = [
  // basics
  ["not true", "false", "bool"],
  ["id 5", "5", "int"],
  ["ignore 5", "()", "unit"],
  ['fst (1, "a")', "1", "int"],
  ['snd (1, "a")', '"a"', "string"],
  ["flip (-) 1 10", "9", "int"],
  ["min 2 3", "2", "int"],
  ['max "a" "b"', '"b"', "string"],
  ["abs (-4)", "4", "int"],
  ["even 4", "true", "bool"],
  ["odd 4", "false", "bool"],
  ["pow 2 10", "1024", "int"],

  // lists
  ["length [1; 2; 3]", "3", "int"],
  ["is_empty []", "true", "bool"],
  ["append [1] [2; 3]", "[1; 2; 3]", "int list"],
  ["[1] @ [2]", "[1; 2]", "int list"],
  ["map (fun x -> x * x) [1; 2; 3]", "[1; 4; 9]", "int list"],
  ["filter even [1; 2; 3; 4]", "[2; 4]", "int list"],
  ["fold_left (-) 0 [1; 2; 3]", "-6", "int"],
  ["fold_right (-) [1; 2; 3] 0", "2", "int"],
  ["rev [1; 2; 3]", "[3; 2; 1]", "int list"],
  ["rev_append [1; 2] [3]", "[2; 1; 3]", "int list"],
  ["exists even [1; 3; 4]", "true", "bool"],
  ["for_all even [2; 4]", "true", "bool"],
  ["mem 3 [1; 2; 3]", "true", "bool"],
  ["take 2 [1; 2; 3]", "[1; 2]", "int list"],
  ["take 9 [1]", "[1]", "int list"],
  ["drop 2 [1; 2; 3]", "[3]", "int list"],
  ["range 1 5", "[1; 2; 3; 4]", "int list"],
  ["range 5 1", "[]", "int list"],
  ["init 4 (fun i -> i * i)", "[0; 1; 4; 9]", "int list"],
  ['repeat 3 "x"', '["x"; "x"; "x"]', "string list"],
  ["sum [1; 2; 3]", "6", "int"],
  ["product [2; 3; 4]", "24", "int"],
  ["concat [[1]; [2; 3]]", "[1; 2; 3]", "int list"],
  ["concat_map (fun x -> [x; x]) [1; 2]", "[1; 1; 2; 2]", "int list"],
  ['zip [1; 2] ["a"; "b"; "c"]', '[(1, "a"); (2, "b")]', "(int * string) list"],
  ['unzip [(1, "a"); (2, "b")]', '([1; 2], ["a"; "b"])', "int list * string list"],
  ["head [1; 2]", "1", "int"],
  ["tail [1; 2]", "[2]", "int list"],
  ["last [1; 2; 3]", "3", "int"],
  ["nth [1; 2; 3] 1", "2", "int"],
  ["maximum [3; 1; 2]", "3", "int"],
  ["minimum [3; 1; 2]", "1", "int"],
  ["iter (fun _ -> ()) [1]", "()", "unit"],

  // sorting
  ["sort [3; 1; 2]", "[1; 2; 3]", "int list"],
  ['sort ["pear"; "apple"]', '["apple"; "pear"]', "string list"],
  ["sort_by (fun a b -> compare b a) [1; 3; 2]", "[3; 2; 1]", "int list"],
  ["halve [1; 2; 3; 4; 5]", "([1; 3; 5], [2; 4])", "int list * int list"],
  ["merge_by compare [1; 3] [2; 4]", "[1; 2; 3; 4]", "int list"],

  // options
  ["is_some (Some 1)", "true", "bool"],
  ["is_none None", "true", "bool"],
  ["with_default 0 (Some 7)", "7", "int"],
  ["with_default 0 None", "0", "int"],
  ["option_map (fun x -> x + 1) (Some 1)", "Some 2", "int option"],
  ["find even [1; 3; 4]", "Some 4", "int option"],
  ["find even [1; 3]", "None", "int option"],
  ['assoc "b" [("a", 1); ("b", 2)]', "Some 2", "int option"],

  // strings
  ['string_join ", " ["a"; "b"]', '"a, b"', "string"],
  ['string_join ", " []', '""', "string"],
  ['string_rev "abc"', '"cba"', "string"],
  ['string_repeat 3 "ab"', '"ababab"', "string"],
  ['split_on "," "a,b,,c"', '["a"; "b"; ""; "c"]', "string list"],
  ['split_on "," ""', '[""]', "string list"],
  ['lines "a\\nb"', '["a"; "b"]', "string list"],
  ['words "  a  b "', '["a"; "b"]', "string list"],
  ['chars "abc"', '["a"; "b"; "c"]', "string list"],
  ["string_of_int (-12)", '"-12"', "string"],
  ['int_of_string "-12"', "-12", "int"],
  ['string_length "abc"', "3", "int"],
  ['string_get "abc" 1', '"b"', "string"],
  ['string_sub "abcdef" 1 3', '"bcd"', "string"],
];

describe("prelude", () => {
  for (const [source, value, type] of cases) {
    test(`${source} => ${value} : ${type}`, () => {
      assert.equal(evaluate(source), value);
      assert.equal(typeOf(source), type);
    });
  }

  test("sort is stable", () => {
    const source = `sort_by (fun (a, _) (b, _) -> compare a b) [(1, "x"); (0, "y"); (1, "z"); (0, "w")]`;
    assert.equal(evaluate(source), '[(0, "y"); (0, "w"); (1, "x"); (1, "z")]');
  });

  test("sort handles a few thousand elements", () => {
    const source = `
let scramble n = (n * 7919) % 10007
let sorted = sort (map scramble (range 0 4000))
do println (string_of_int (length sorted))
do println (show (for_all (fun (a, b) -> a <= b) (zip sorted (drop 1 sorted))))
`;
    assert.deepEqual(lines(source), ["4000", "true"]);
  });

  test("string functions agree on code points, not UTF-16 units", () => {
    assert.equal(evaluate('string_length "a\u{1f642}b"'), "3");
    assert.equal(evaluate('length (chars "a\u{1f642}b")'), "3");
    assert.equal(evaluate('string_get "a\u{1f642}b" 1'), '"\u{1f642}"');
    assert.equal(evaluate('string_sub "a\u{1f642}bc" 1 2'), '"\u{1f642}b"');
    assert.equal(evaluate('string_rev "a\u{1f642}b"'), '"b\u{1f642}a"');
  });

  test("partial functions fail loudly", () => {
    assertError(failure("do println (show (head []))"), "runtime", "head: empty list");
    assertError(failure("do println (show (tail []))"), "runtime", "tail: empty list");
    assertError(failure("do println (show (last []))"), "runtime", "last: empty list");
    assertError(failure("do println (show (nth [1] 5))"), "runtime", "index out of bounds");
  });
});

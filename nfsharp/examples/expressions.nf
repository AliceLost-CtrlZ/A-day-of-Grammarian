// An expression language inside the expression language: an AST, an evaluator,
// and a pretty-printer that only parenthesises where it has to.

type expr =
  | Num of int
  | Add of expr * expr
  | Sub of expr * expr
  | Mul of expr * expr
  | Div of expr * expr

let rec eval e =
  match e with
  | Num n -> n
  | Add (a, b) -> eval a + eval b
  | Sub (a, b) -> eval a - eval b
  | Mul (a, b) -> eval a * eval b
  | Div (a, b) -> eval a / eval b

(* `show_sum` and `show_product` call each other, which is what `and` is for:
   both names exist before either body is checked. *)
let rec show_sum e =
  match e with
  | Add (a, b) -> show_sum a ^ " + " ^ show_product b
  | Sub (a, b) -> show_sum a ^ " - " ^ show_product b
  | _ -> show_product e
and show_product e =
  match e with
  | Mul (a, b) -> show_product a ^ " * " ^ show_atom b
  | Div (a, b) -> show_product a ^ " / " ^ show_atom b
  | _ -> show_atom e
and show_atom e =
  match e with
  | Num n -> string_of_int n
  | _ -> "(" ^ show_sum e ^ ")"

let report e = println (show_sum e ^ " = " ^ string_of_int (eval e))

// (1 + 2) * 3
let a = Mul (Add (Num 1, Num 2), Num 3)
// 100 / (2 + 3) - 4 * 5
let b = Sub (Div (Num 100, Add (Num 2, Num 3)), Mul (Num 4, Num 5))
// 1 - (2 - 3)
let c = Sub (Num 1, Sub (Num 2, Num 3))

do iter report [a; b; c]

// Folding a list of numbers into a left-leaning sum, then evaluating it.
let total = fold_left (fun acc n -> Add (acc, Num n)) (Num 0) [1; 2; 3; 4]

do report total

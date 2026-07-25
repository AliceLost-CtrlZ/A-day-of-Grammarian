// A reverse-polish calculator: a tiny interpreter, written in a tiny language.

let apply_binary f stack =
  match stack with
  | b :: a :: rest -> f a b :: rest
  | _ -> failwith "stack underflow"

let step stack token =
  match token with
  | "+" -> apply_binary (fun a b -> a + b) stack
  | "-" -> apply_binary (fun a b -> a - b) stack
  | "*" -> apply_binary (fun a b -> a * b) stack
  | "/" -> apply_binary (fun a b -> a / b) stack
  | _ -> int_of_string token :: stack

let eval source =
  match fold_left step [] (words source) with
  | result :: [] -> result
  | _ -> failwith ("malformed expression: " ^ source)

let report source = println (source ^ "  =>  " ^ string_of_int (eval source))

do iter report
     [ "3 4 +"
     ; "3 4 + 2 *"
     ; "12 3 / 4 -"
     ; "2 3 4 * +"
     ; "5 1 2 + 4 * + 3 -" ]

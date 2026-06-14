import random
import os
import sys
import json
import datetime

def parse_answer(s):
    mapping = {
        '1': 'A', '2': 'B', '3': 'C', '4': 'D',
        'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D',
        'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D',
    }
    letters = [mapping[c] for c in s if c in mapping]
    sorted_letters = sorted(set(letters))
    return ''.join(sorted_letters)

def pick_random_questions(file_path, num_list):
    
    with open(file_path, 'r', encoding='utf-8') as f:
        questions = json.load(f)  # 去掉空行和换行符
    rnd_q = []
    if type(questions) == dict:
        if num_list <= 0:
            num_list = -num_list
            if num_list == 0:
                num_list = len(questions)
            list_added = 0
            for q_no, q_list in questions.items():
                for q in q_list:
                    rnd_q.append((q_no,q))
                list_added += 1
                if list_added == num_list:
                    break
        else:
            for q_no, q_list in questions.items():
                if int(q_no) == num_list:
                    for q in q_list:
                        rnd_q.append((q_no,q))
                    break

            # for question in question_list :
            #     rnd_questions.insert({question_list.})
    else:
        rnd_q = questions
    return random.sample(rnd_q, len(rnd_q))

def epoch(questions):
    os.system("cls" if os.name == "nt" else "clear")

    incorrect = []
    count = 1
    for question in questions:
        chapter, q = question
        print(f'{count} / {len(questions)} ','\033[32m', '█'*int(count*80/len(questions))+'\033[30m'+'█'*(80-int(count*80/len(questions)))+'\033[0m\n')
        print("@ Chapter", chapter)
        print(">\033[1;33m",q['topic'],'\033[0m')


        for choice in q['options']:
            if str.upper(choice[0]) != 'E':
                print('-',choice)
                
            
        inpu = input("# ")
        if inpu == 'quit' or inpu == 'exit':
            return count, incorrect
        elif parse_answer(str.upper(inpu)) == q['answer']:
            print('✅')
        else:
            incorrect.append(question)
            print('❌', q['answer'])
        input("Press Enter to continue...")
        
        os.system("cls" if os.name == "nt" else "clear")
        count = count + 1
    return count, incorrect

# 使用方法示例
if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] == '-h' or sys.argv[1] == '--help':
        print("\nThis is a simple script to exercise on selection problems of Software Engineering course of ZJU.\n")
        print("Usage: python se_regressor.py <file_name> <chapter_number>")
        print("<file_name> is the path to the JSON file containing questions.")
        print("If <chapter_number> is positive, it will use the Nth chapter.")
        print("If <chapter_number> is negative, it will use the first N chapters.")
        print("If <chapter_number> is not provided, questions from all chapters will be used.")
        print("Example: python se_regressor.py tiku.json 1\n")
        print("You may use 1/a/A to select option A, and 2/b/B to select option B, etc.")
        print("When there are multiple correct answers, you can input them in any order, e.g., 'b1 D' or 'ABD'.")
        print("To quit at any time, type \'quit\' or \'exit\' and press Enter, and a report will be generated.")

        sys.exit(1)
    if len(sys.argv) == 2:
        q = pick_random_questions(sys.argv[1], 0)  # 替换为你的 JSON 文件路径
    else:
        q = pick_random_questions(sys.argv[1], int(sys.argv[2]))
    total_num,incorrects = epoch(q)
    if not os.path.exists('record'):
        os.makedirs('record')
    filename = "record/inc"+datetime.datetime.now().strftime('%m_%d_%H.%M.%S')+".json"

    print("============== Report ==============")
    if len(sys.argv)>2:
        if int(sys.argv[2]) > 0:
            print("- Training on list \033[1;34m"+sys.argv[2]+"\033[0m.\n- Epoch Finished,\033[1;31m",len(incorrects),'/',total_num-1,"\033[0mincorrects.\n- Next epoch: \033[1;33m"+filename+"\033[0m" )
        else:
            print("- Training on list \033[1;34m1 - "+str(-int(sys.argv[2]))+"\033[0m.\n- Epoch Finished,\033[1;31m",len(incorrects),'/',total_num-1,"\033[0mincorrects.\n- Next epoch: \033[1;33m"+filename+"\033[0m" )
    else:
        print("- Training on \033[1;33m"+sys.argv[1]+"\033[0m.\n- Epoch Finished,\033[1;31m",len(incorrects),'/',total_num-1,"\033[0mincorrects.\n- Next epoch: \033[1;33m"+filename+"\033[0m" )
    print("====================================")
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(incorrects,f)
    

        
    